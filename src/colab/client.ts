import { UUID } from "crypto";
import * as https from "node:https";
import fetch, { Headers, Request, RequestInit, Response } from "node-fetch";
import { z } from "zod";
import {
  Assignment,
  AssignmentSchema,
  CcuInfo,
  CcuInfoSchema,
  GetAssignmentResponse,
  GetAssignmentResponseSchema,
  Kernel,
  KernelSchema,
  ListedAssignment,
  ListedAssignmentsSchema,
  Outcome,
  PostAssignmentResponse,
  PostAssignmentResponseSchema,
  RuntimeProxyInfo,
  RuntimeProxyInfoSchema,
  Session,
  SessionSchema,
  Variant,
} from "./api.js";
import {
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "./headers.js";
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_XSRF_TOKEN_HEADER,
} from "./headers.js";
import { uuidToWebSafeBase64 } from "../utils/uuid.js";
import { getFileLogger } from "../utils/file-logger.js";

const XSSI_PREFIX = ")]}'\n";
const TUN_ENDPOINT = "/tun/m";

interface AssignmentToken extends GetAssignmentResponse {
  kind: "to_assign";
}

interface AssignedAssignment extends Assignment {
  kind: "assigned";
}

export class ColabClient {
  private readonly httpsAgent?: https.Agent;

  constructor(
    private readonly colabDomain: URL,
    private readonly colabGapiDomain: URL,
    private readonly getAccessToken: () => Promise<string>,
  ) {
    if (colabDomain.hostname === "localhost") {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  async getSubscriptionTier(signal?: AbortSignal) {
    const url = new URL("v1/user-info", this.colabGapiDomain);
    const info = await this.issueRequest(url, { method: "GET", signal }, z.object({
      subscriptionTier: z.number(),
    }));
    return info.subscriptionTier;
  }

  async getCcuInfo(signal?: AbortSignal): Promise<CcuInfo> {
    return this.issueRequest(
      new URL(`${TUN_ENDPOINT}/ccu-info`, this.colabDomain),
      { method: "GET", signal },
      CcuInfoSchema,
    );
  }

  async assign(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: string,
    signal?: AbortSignal,
  ): Promise<{ assignment: Assignment; isNew: boolean }> {
    const assignment = await this.getAssignment(
      notebookHash,
      variant,
      accelerator,
      signal,
    );
    switch (assignment.kind) {
      case "assigned": {
        const { kind: _, ...rest } = assignment;
        return { assignment: rest, isNew: false };
      }
      case "to_assign": {
        let res: PostAssignmentResponse;
        try {
          res = await this.postAssignment(
            notebookHash,
            assignment.xsrfToken,
            variant,
            accelerator,
            signal,
          );
        } catch (error) {
          if (
            error instanceof ColabRequestError &&
            error.response.status === 412
          ) {
            throw new TooManyAssignmentsError(error.message);
          }
          throw error;
        }
        switch (res.outcome) {
          case Outcome.QUOTA_DENIED_REQUESTED_VARIANTS:
          case Outcome.QUOTA_EXCEEDED_USAGE_TIME:
            throw new InsufficientQuotaError(
              "Insufficient quota to assign server",
            );
          case Outcome.DENYLISTED:
            throw new DenylistedError(
              "Account has been blocked from accessing Colab servers.",
            );
          default:
            return {
              assignment: AssignmentSchema.parse(res),
              isNew: true,
            };
        }
      }
    }
  }

  async refreshConnection(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<RuntimeProxyInfo> {
    const url = new URL(`${TUN_ENDPOINT}/runtime-proxy-token`, this.colabDomain);
    url.searchParams.append("endpoint", endpoint);
    url.searchParams.append("port", "8080");
    return this.issueRequest(
      url,
      {
        method: "GET",
        headers: { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value },
        signal,
      },
      RuntimeProxyInfoSchema,
    );
  }

  async listAssignments(signal?: AbortSignal): Promise<ListedAssignment[]> {
    const assignments = await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/assignments`, this.colabDomain),
      { method: "GET", signal },
      ListedAssignmentsSchema,
    );
    return assignments.assignments;
  }

  async sendKeepAlive(endpoint: string, signal?: AbortSignal): Promise<void> {
    await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/${endpoint}/keep-alive/`, this.colabDomain),
      {
        method: "GET",
        headers: { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value },
        signal,
      },
    );
  }

  // Jupyter Kernel REST API Methods

  /**
   * List all kernels on a runtime
   */
  async listKernels(
    runtimeProxyUrl: string,
    runtimeProxyToken: string,
    signal?: AbortSignal
  ): Promise<Kernel[]> {
    const url = new URL("api/kernels", runtimeProxyUrl);
    return this.issueRuntimeRequest(
      url,
      {
        method: "GET",
        signal,
      },
      runtimeProxyToken,
      z.array(KernelSchema)
    );
  }

  /**
   * Get details about a specific kernel
   */
  async getKernel(
    kernelId: string,
    runtimeProxyUrl?: string,
    runtimeProxyToken?: string,
    signal?: AbortSignal
  ): Promise<Kernel> {
    // If proxy info not provided, we need to fetch via stored state
    // For now, require the proxy info
    if (!runtimeProxyUrl || !runtimeProxyToken) {
      throw new Error("Runtime proxy URL and token are required to get kernel info");
    }
    const url = new URL(`api/kernels/${kernelId}`, runtimeProxyUrl);
    return this.issueRuntimeRequest(
      url,
      { method: "GET", signal },
      runtimeProxyToken,
      KernelSchema
    );
  }

  /**
   * Create a new Jupyter session (which creates a kernel)
   */
  async createSession(
    notebookPath: string,
    kernelName: string,
    runtimeProxyUrl?: string,
    runtimeProxyToken?: string,
    signal?: AbortSignal
  ): Promise<Session> {
    // For now, we use a cached runtime proxy info
    // This will be provided by the connection flow
    if (!runtimeProxyUrl || !runtimeProxyToken) {
      throw new Error("Runtime proxy URL and token are required to create session");
    }

    const url = new URL("api/sessions", runtimeProxyUrl);
    return this.issueRuntimeRequest(
      url,
      {
        method: "POST",
        signal,
        body: JSON.stringify({
          path: notebookPath,
          name: notebookPath,
          type: "notebook",
          kernel: { name: kernelName },
        }),
      },
      runtimeProxyToken,
      SessionSchema
    );
  }

  /**
   * Get session details
   */
  async getSession(
    sessionId: string,
    runtimeProxyUrl: string,
    runtimeProxyToken: string,
    signal?: AbortSignal
  ): Promise<Session> {
    const url = new URL(`api/sessions/${sessionId}`, runtimeProxyUrl);
    return this.issueRuntimeRequest(
      url,
      { method: "GET", signal },
      runtimeProxyToken,
      SessionSchema
    );
  }

  /**
   * Delete a kernel
   */
  async deleteKernel(
    kernelId: string,
    runtimeProxyUrl?: string,
    runtimeProxyToken?: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (!runtimeProxyUrl || !runtimeProxyToken) {
      throw new Error("Runtime proxy URL and token are required to delete kernel");
    }
    const url = new URL(`api/kernels/${kernelId}`, runtimeProxyUrl);
    await this.issueRuntimeRequest(
      url,
      { method: "DELETE", signal },
      runtimeProxyToken
    );
  }

  /**
   * Issue a request to the runtime proxy (not to the main Colab API)
   */
  private async issueRuntimeRequest<T extends z.ZodType>(
    endpoint: URL,
    init: RequestInit,
    runtimeProxyToken: string,
    schema: T,
  ): Promise<z.infer<T>>;
  private async issueRuntimeRequest(
    endpoint: URL,
    init: RequestInit,
    runtimeProxyToken: string,
  ): Promise<void>;
  private async issueRuntimeRequest(
    endpoint: URL,
    init: RequestInit,
    runtimeProxyToken: string,
    schema?: z.ZodType,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);
    headers.set(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key, runtimeProxyToken);
    headers.set(COLAB_CLIENT_AGENT_HEADER.key, COLAB_CLIENT_AGENT_HEADER.value);

    if (init.body) {
      headers.set("Content-Type", "application/json");
    }

    const request = new Request(endpoint, {
      ...init,
      headers,
      agent: this.httpsAgent,
    });

    const response = await fetch(request);
    if (!response.ok) {
      let errorBody: string | undefined;
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      throw new ColabRequestError({ request, response, responseBody: errorBody });
    }

    if (!schema) {
      return;
    }

    const body = await response.text();
    // Runtime API doesn't use XSSI prefix
    return schema.parse(JSON.parse(body));
  }

  private async getAssignment(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: string,
    signal?: AbortSignal,
  ): Promise<AssignmentToken | AssignedAssignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    const response = await this.issueRequest(
      url,
      { method: "GET", signal },
      z.union([GetAssignmentResponseSchema, AssignmentSchema]),
    );
    if ("xsrfToken" in response) {
      return { ...response, kind: "to_assign" };
    }
    return { ...response, kind: "assigned" };
  }

  private async postAssignment(
    notebookHash: UUID,
    xsrfToken: string,
    variant: Variant,
    accelerator?: string,
    signal?: AbortSignal,
  ): Promise<PostAssignmentResponse> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    return this.issueRequest(
      url,
      {
        method: "POST",
        headers: { [COLAB_XSRF_TOKEN_HEADER.key]: xsrfToken },
        signal,
      },
      PostAssignmentResponseSchema,
    );
  }

  private buildAssignUrl(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: string,
  ): URL {
    const url = new URL(`${TUN_ENDPOINT}/assign`, this.colabDomain);
    url.searchParams.append("nbh", uuidToWebSafeBase64(notebookHash));
    if (variant !== Variant.DEFAULT) {
      url.searchParams.append("variant", variant);
    }
    if (accelerator) {
      url.searchParams.append("accelerator", accelerator);
    }
    return url;
  }

  private async issueRequest<T extends z.ZodType>(
    endpoint: URL,
    init: RequestInit,
    schema: T,
  ): Promise<z.infer<T>>;
  private async issueRequest(endpoint: URL, init: RequestInit): Promise<void>;
  private async issueRequest(
    endpoint: URL,
    init: RequestInit,
    schema?: z.ZodType,
  ): Promise<unknown> {
    const logger = getFileLogger();
    const startTime = Date.now();
    
    if (endpoint.hostname === this.colabDomain.hostname) {
      endpoint.searchParams.append("authuser", "0");
    }
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);
    headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
    headers.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    const request = new Request(endpoint, {
      ...init,
      headers,
      agent: this.httpsAgent,
    });
    
    try {
      const response = await fetch(request);
      const durationMs = Date.now() - startTime;
      
      if (!response.ok) {
        let errorBody: string | undefined;
        try {
          errorBody = await response.text();
        } catch {
          // ignore
        }
        const error = new ColabRequestError({ request, response, responseBody: errorBody });
        logger?.logApi(init.method ?? "GET", endpoint.pathname, response.status, durationMs, error);
        throw error;
      }
      
      logger?.logApi(init.method ?? "GET", endpoint.pathname, response.status, durationMs);
      
      if (!schema) {
        return;
      }
      const body = await response.text();
      return schema.parse(JSON.parse(stripXssiPrefix(body)));
    } catch (error) {
      if (error instanceof ColabRequestError) {
        throw error;
      }
      const durationMs = Date.now() - startTime;
      logger?.logApi(init.method ?? "GET", endpoint.pathname, undefined, durationMs, error instanceof Error ? error : undefined);
      throw error;
    }
  }
}

export class TooManyAssignmentsError extends Error {}
export class DenylistedError extends Error {}
export class InsufficientQuotaError extends Error {}

export class ColabRequestError extends Error {
  readonly request: Request;
  readonly response: Response;
  readonly responseBody?: string;

  constructor({
    request,
    response,
    responseBody,
  }: {
    request: Request;
    response: Response;
    responseBody?: string;
  }) {
    super(
      `Failed request ${request.method} ${request.url}: ${response.statusText}` +
        (responseBody ? `\nResponse body: ${responseBody}` : ""),
    );
    this.request = request;
    this.response = response;
    this.responseBody = responseBody;
  }
}

function stripXssiPrefix(body: string): string {
  if (body.startsWith(XSSI_PREFIX)) {
    return body.slice(XSSI_PREFIX.length);
  }
  return body;
}
