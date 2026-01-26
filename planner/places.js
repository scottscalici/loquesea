export function getPlace(id, places) {
  return places[id] || null;
}

export function getMapsLink(place) {
  if (!place) return null;

  if (place.coordinates) {
    return `https://maps.apple.com/?ll=${place.coordinates.lat},${place.coordinates.lng}`;
  }

  if (place.address) {
    const { line1, city, state, zip } = place.address;
    const q = `${line1}, ${city}, ${state} ${zip}`;
    return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  }

  return null;
}
