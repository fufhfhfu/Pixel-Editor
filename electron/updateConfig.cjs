const { load } = require('js-yaml');

function hasPublisherName(updateConfigYaml) {
  const config = load(updateConfigYaml);
  const publisherName = config?.publisherName;
  return typeof publisherName === 'string'
    ? publisherName.trim().length > 0
    : Array.isArray(publisherName) && publisherName.some((name) =>
      typeof name === 'string' && name.trim().length > 0,
    );
}

module.exports = { hasPublisherName };
