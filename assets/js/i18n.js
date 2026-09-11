import STRINGS from '../i18n/strings.json'

export function t (locale, key, vars) {
  const template = (STRINGS[locale] || STRINGS.en)[key]

  if (vars) {
    return template.replace(/{(\w+)}/g, (match, name) => Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match)
  }

  return template
}
