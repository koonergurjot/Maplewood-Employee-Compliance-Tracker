let AsyncFunction = null;

try {
  AsyncFunction = new Function('return Object.getPrototypeOf(async function () {}).constructor;')();
} catch (error) {
  AsyncFunction = null;
}

if (
  typeof AsyncFunction === 'function' &&
  AsyncFunction !== Function &&
  !Function.prototype.__maplewoodPatchedCall
) {
  const originalCall = Function.prototype.call;

  if (typeof originalCall === 'function') {
    const functionToString = Function.prototype.toString;
    const isAsyncFunction = fn => typeof fn === 'function' && fn instanceof AsyncFunction;
    const isNativeFunction = fn => {
      if (typeof fn !== 'function') {
        return false;
      }
      try {
        const source = Reflect.apply(functionToString, fn, []);
        return /\[native code\]/.test(source);
      } catch (error) {
        return false;
      }
    };

    Object.defineProperty(Function.prototype, '__maplewoodPatchedCall', {
      value: true,
      configurable: true
    });

    Function.prototype.call = function patchedFunctionCall(context, ...args) {
      const result = Reflect.apply(originalCall, this, [context, ...args]);

      if (isNativeFunction(this)) {
        return result;
      }

      if (isAsyncFunction(this)) {
        return Promise.resolve(result);
      }

      return result;
    };
  }
}
