const { withPodfile } = require('@expo/config-plugins');

function addUseModularHeaders(contents) {
  if (contents.includes('use_modular_headers!')) return contents;

  const platformRe = /(platform :ios, [^\n]+\n)/;
  if (platformRe.test(contents)) {
    return contents.replace(platformRe, `$1use_modular_headers!\n`);
  }

  return `use_modular_headers!\n${contents}`;
}

module.exports = function withIosModularHeaders(config) {
  return withPodfile(config, (config) => {
    config.modResults.contents = addUseModularHeaders(config.modResults.contents);
    return config;
  });
};

