/** Plural of a building or ship name: "Refinery" becomes "Refineries", "Depot" becomes "Depots". */
export function plural(name: string): string {
  return /[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`;
}
