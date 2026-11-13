function getSafeExternalUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.href;
  } catch {
    return null;
  }
}

module.exports = { getSafeExternalUrl };
