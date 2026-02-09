const isSharedArrayBufferInstance = (value: any): boolean => {
  if (!value) {
    return false;
  }

  if (value instanceof SharedArrayBuffer) {
    return true;
  }

  if (Object.prototype.toString.call(value) === '[object SharedArrayBuffer]') {
    return true;
  }

  return value?.constructor?.name === 'SharedArrayBuffer';
};

export const isSharedArrayBuffer = (input: any): boolean => {
  if (isSharedArrayBufferInstance(input)) {
    return true;
  }

  if (!Buffer.isBuffer(input)) {
    return false;
  }

  return isSharedArrayBufferInstance(input.buffer);
};
