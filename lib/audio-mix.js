function mixFloat32Samples(inputs) {
  const activeInputs = inputs.filter(input => input && input.length > 0);
  if (activeInputs.length === 0) return new Float32Array(0);

  const length = Math.max(...activeInputs.map(input => input.length));
  const output = new Float32Array(length);

  for (const input of activeInputs) {
    for (let i = 0; i < length; i++) {
      output[i] += input[i] || 0;
    }
  }

  const gain = 1 / Math.max(1, activeInputs.length);
  for (let i = 0; i < output.length; i++) {
    const sample = output[i] * gain;
    output[i] = Math.max(-1, Math.min(1, sample));
  }

  return output;
}

module.exports = { mixFloat32Samples };
