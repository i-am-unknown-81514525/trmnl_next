export function normalizeLon(lon: number) {
    let v = lon;
    while (v > 180) v -= 360;
    while (v <= -180) v += 360;
    return v;
}

export function clampLat(lat: number) {
    if (lat > 90) return 90;
    if (lat < -90) return -90;
    return lat;
}

export function degToRad(d: number) {
    return (d * Math.PI) / 180;
}