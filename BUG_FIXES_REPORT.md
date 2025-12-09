# Bug Fixes Report - LeCoder cGPU CLI
**Date**: December 9, 2025  
**Critical bugs found during pre-launch testing**

---

## Bug #1: TPU Flag Not Respected (CRITICAL)

### Issue
When user runs `lecoder-cgpu connect --tpu`, the CLI connects to a GPU (A100) instead:

```bash
$ lecoder-cgpu connect --tpu
Authenticated as Arya Creator <aryayt55@gmail.com>
Opening terminal session 3 on Colab GPU A100...  # <-- Should be TPU!
Connected! Use Ctrl+C twice to exit.
```

### Root Cause
The runtime label is built using the *requested* variant instead of the *assigned* variant.

**Location**: `src/runtime/runtime-manager.ts:217`

```typescript
private async runtimeFromAssignment(
  assignment: {
    accelerator: string;
    endpoint: string;
  },
  variant: Variant,  // <-- THIS IS THE REQUESTED VARIANT
): Promise<AssignedRuntime> {
  const proxy = await this.client.refreshConnection(assignment.endpoint);
  return {
    label: `Colab ${variantLabel(variant)} ${assignment.accelerator}`,  // <-- BUG HERE
    accelerator: assignment.accelerator,
    endpoint: assignment.endpoint,
    proxy,
  };
}
```

When reusing an existing runtime, it uses the requested variant (TPU) but the actual accelerator (A100 GPU), creating a misleading label like "Colab TPU A100".

### Fix
The `findReusableAssignment` function correctly filters by variant, but we need to ensure the label reflects what was actually assigned, not what was requested. There are two scenarios:

1. **Reusing correct variant**: Label should match
2. **No runtime of requested type**: Should error out clearly, not use wrong type

The current code at line 205 does filter correctly:
```typescript
return assignments.find((assignment) => assignment.variant === variant);
```

But the issue is that the assignment's variant field might not be populated correctly by the Colab API, OR the user already has a GPU runtime when they request TPU.

### Solution

Update `runtimeFromAssignment` to verify the assignment variant matches:

```typescript
private async runtimeFromAssignment(
  assignment: {
    accelerator: string;
    endpoint: string;
    variant?: Variant;  // Add variant to interface
  },
  requestedVariant: Variant,
): Promise<AssignedRuntime> {
  const proxy = await this.client.refreshConnection(assignment.endpoint);
  
  // Use the assignment's actual variant if available, otherwise trust requested
  const actualVariant = assignment.variant ?? requestedVariant;
  
  // Warn if mismatch
  if (assignment.variant && assignment.variant !== requestedVariant) {
    const logger = getFileLogger();
    logger?.warn("RUNTIME", "Variant mismatch", {
      requested: requestedVariant,
      assigned: assignment.variant
    });
  }
  
  return {
    label: `Colab ${variantLabel(actualVariant)} ${assignment.accelerator}`,
    accelerator: assignment.accelerator,
    endpoint: assignment.endpoint,
    proxy,
  };
}
```

**Better Solution**: Add clear error when no runtime of requested type is available:

```typescript
private async findReusableAssignment(variant: Variant) {
  const assignments = await this.client.listAssignments();
  const matching = assignments.find((assignment) => assignment.variant === variant);
  
  if (!matching && assignments.length > 0) {
    // Found runtimes but not of requested type
    const availableTypes = [...new Set(assignments.map(a => variantLabel(a.variant)))].join(", ");
    throw new Error(
      `No ${variantLabel(variant)} runtime available. ` +
      `You have: ${availableTypes}. ` +
      `Either disconnect other runtimes or omit the --${variant.toLowerCase()} flag to use what's available.`
    );
  }
  
  return matching;
}
```

---

## Bug #2: Misleading "Opening terminal session" Message

### Issue
The message says "Opening terminal session 3" but the number comes from the remote terminal name, not a session counter.

### Location
`src/runtime/terminal-session.ts:24`

### Fix
Make message clearer:

```typescript
console.log(
  chalk.gray(
    `Connecting to ${this.runtime.label}...`,  // Simpler, clearer
  ),
);
```

---

## Bug #3: Test Failures (26 tests failing)

### Categories of Failures

**1. connect-command.test.ts (21 failures)**
- Issue: Mock kernel client missing `getKernelInfo` method
- Fix: Update mock to include all required methods

**2. error-handler.test.ts (2 failures)**
- Syntax error categorization wrong
- Unknown error categorization wrong
- Fix: Review error categorization logic

**3. connection-pool.test.ts (1 failure)**
- Concurrent connection test expecting same object reference
- Fix: Update test to check functional equality, not reference equality

**4. session-manager.test.ts (4 failures)**
- Runtime state checks failing
- Fix: Mock runtime assignments properly

**5. full-workflow.test.ts (2 failures)**
- Multi-session tests expecting 3 sessions but getting 1
- Fix: Ensure test creates sessions properly

---

## Bug #4: Session Label Mismatch

### Issue
Similar to Bug #1, session labels use requested variant instead of assigned:

**Location**: `src/session/session-manager.ts:82`

```typescript
const label = params.label ?? `Colab ${params.variant.toUpperCase()} ${runtime.accelerator}`;
```

If runtime is A100 but variant requested was TPU, label becomes "Colab TPU A100".

### Fix
Use runtime's actual variant:

```typescript
// runtime-manager should return variant in AssignedRuntime
const label = params.label ?? runtime.label; // Trust the runtime's own label
```

---

## Recommended Action Plan

### Priority 1 (Must Fix Before Launch)

1. **Fix TPU/CPU flag bug**
   - Update `findReusableAssignment` to error clearly when type not available
   - Update `runtimeFromAssignment` to warn on variant mismatch
   - Add integration test for variant selection

2. **Fix misleading terminal message**
   - Simplify connection message
   - Remove confusing "session 3" number

### Priority 2 (Should Fix)

3. **Fix critical test failures**
   - Fix connect-command mock
   - Fix error categorization tests
   - Bring pass rate from 86% to 95%+

### Priority 3 (Nice to Have)

4. **Add variant validation**
   - Validate requested variant is available before attempting connection
   - Provide clear error messages with remediation steps
   - Add `--force-variant` flag to override safety checks

---

## Testing Plan

After fixes, verify:

```bash
# Test 1: TPU request with no TPU available
lecoder-cgpu connect --tpu
# Expected: Clear error "No TPU runtime available..."

# Test 2: CPU request
lecoder-cgpu connect --cpu
# Expected: Connects to CPU, label shows "Colab CPU"

# Test 3: GPU request (default)
lecoder-cgpu connect
# Expected: Connects to GPU, label shows correct GPU type

# Test 4: Run tests
npm test
# Expected: 95%+ pass rate
```

---

## Files to Modify

1. `src/runtime/runtime-manager.ts`
   - Fix `runtimeFromAssignment` (line 208-222)
   - Fix `findReusableAssignment` (line 203-206)
   - Fix `requestFreshAssignment` (line 64-141)

2. `src/runtime/terminal-session.ts`
   - Fix connection message (line 24)

3. `src/session/session-manager.ts`
   - Update label construction (line 82)

4. `tests/integration/connect-command.test.ts`
   - Fix kernel client mock

5. `tests/unit/error-handler.test.ts`
   - Fix categorization expectations

6. `tests/unit/session-manager.test.ts`
   - Fix runtime state mocks

---

## Impact Assessment

### User Impact
- **High**: Users requesting TPU/CPU get wrong runtime with misleading messages
- **Confusion**: Leads to wasted compute credits and confusion
- **Trust**: Damages trust in CLI accuracy

### Risk of Fix
- **Low**: Changes are localized to label/variant handling
- **No breaking changes**: API remains the same
- **Easy to test**: Clear test cases for each variant

---

## Conclusion

**Recommendation**: Fix Priority 1 bugs before public launch. Priority 2 can be addressed in v0.5.2 patch release.

**Estimated Time**:
- Priority 1 fixes: 2-3 hours
- Priority 2 fixes: 4-5 hours
- Testing: 1-2 hours

**Total**: 7-10 hours to production-ready state

---

**Next Steps**:
1. Review this report
2. Approve fix approach
3. Implement fixes
4. Run comprehensive testing
5. Update CHANGELOG.md
6. Prepare v0.5.2 release

