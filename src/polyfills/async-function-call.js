const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
if (AsyncFunction && AsyncFunction.prototype && !AsyncFunction.prototype.__maplewoodPatchedCall) {
  const originalCall = AsyncFunction.prototype.call;
  if (typeof originalCall === 'function') {
    Object.defineProperty(AsyncFunction.prototype, '__maplewoodPatchedCall', {
      value: true,
      configurable: true
    });
    AsyncFunction.prototype.call = function patchedAsyncCall(context, ...args) {
      const result = originalCall.call(this, context, ...args);
      return Promise.resolve(result);
    };
  }
}
