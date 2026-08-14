// Teachers ride in with the students on the Round-1 MORNING run only (they do not ride
// back). So the morning route a driver actually drives is not the student route: the bus
// has to divert to collect its teachers on the way to school.
//
// A teacher is placed into the bus's existing pickup sequence by cheapest insertion — the
// gap between two consecutive points where adding the teacher grows the route least. That
// is the same marginal-insertion rule the optimisation engine uses to cost a student, so
// the two stay consistent.

import { hav } from "./utils.js";

/**
 * Merge a bus's teachers into its ordered student stops.
 *
 * @param order     ordered student stops  [{latitude,longitude,...}]
 * @param teachers  that bus's teachers    [{name,latitude,longitude,emp_code}]
 * @param depot     [lat,lon] start point, or null (route then starts at the first stop)
 * @param schoolPt  [lat,lon] school, or null
 * @returns {seq, addedKm} seq = merged stops tagged kind:'student'|'teacher';
 *          addedKm = straight-line km the teacher diversions add to the route.
 */
export function insertTeachers(order, teachers, depot, schoolPt){
  const seq = (order || []).map(s => ({ ...s, kind: 'student' }));
  const list = (teachers || []).filter(t => t.latitude != null && t.longitude != null);
  if (!list.length) return { seq, addedKm: 0 };

  let addedKm = 0;
  for (const t of list){
    // The full drive for this leg-search: depot → stops so far → school. Rebuilt each
    // time so a teacher can be inserted next to a teacher inserted before them.
    const pts = [];
    if (depot) pts.push([depot[0], depot[1]]);
    seq.forEach(s => pts.push([s.latitude, s.longitude]));
    if (schoolPt) pts.push([schoolPt[0], schoolPt[1]]);

    if (pts.length < 2){ seq.push({ ...t, kind: 'teacher' }); continue; }

    let bestGap = 0, bestCost = Infinity;
    for (let i = 0; i < pts.length - 1; i++){
      const a = pts[i], b = pts[i + 1];
      // detour = go via the teacher instead of straight from a to b (>= 0 by triangle ineq.)
      const cost = hav(a[0], a[1], t.latitude, t.longitude)
                 + hav(t.latitude, t.longitude, b[0], b[1])
                 - hav(a[0], a[1], b[0], b[1]);
      if (cost < bestCost){ bestCost = cost; bestGap = i; }
    }
    // gap i sits between pts[i] and pts[i+1]; drop the leading depot to get the seq index
    const at = Math.max(0, Math.min(seq.length, bestGap - (depot ? 1 : 0) + 1));
    seq.splice(at, 0, { ...t, kind: 'teacher' });
    addedKm += bestCost;
  }
  return { seq, addedKm };
}

/**
 * Road km the teacher diversions add. The straight-line detour is scaled by the bus's own
 * measured road factor (road km / straight km) from bus_route_geo, so the figure sits on
 * the same footing as every other road number in the app rather than being invented.
 * Falls back to the fleet-average factor when a bus has none.
 */
export function teacherRoadKm(addedKm, factor){
  const f = Number(factor);
  return addedKm * (Number.isFinite(f) && f > 0 ? f : 1.375);
}

Object.assign(globalThis, { insertTeachers, teacherRoadKm });
