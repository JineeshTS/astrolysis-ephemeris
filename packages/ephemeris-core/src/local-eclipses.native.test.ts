import {describe,expect,it} from 'vitest';
import {ensureSweph} from './sweph';
import {engineIdentity} from './rpc';
import {localEclipses} from './local-eclipses';
const ready=await ensureSweph().then(()=>engineIdentity().ephemeris==='swiss',()=>false);
if(!ready&&process.env.REQUIRE_NATIVE_EPHEMERIS==='1')throw Error('Required native Swiss local eclipse data unavailable');
const jd=(date:string)=>Date.parse(date)/86400000+2440587.5;
const events=(date:string,lat:number,lng:number,days=1)=>localEclipses(jd(date),jd(date)+days,lat,lng).events;
describe.skipIf(!ready)('native local eclipse reference and visibility cases',()=>{
 it('compares Cleburne2024 contacts with the USNO local reference within60seconds',()=>{
  // Primary table: https://aa.usno.navy.mil/calculated/eclipse/solar?eclipse=12024&height=244&label=Cleburne%2C+TX&lat=32.346975&lon=-97.386246&submit=Get+Data
  // Retrieved2026-10-22. Reference244m versus our0m; distinct deltaT/ephemerides. Tolerance is a comparison bound, not guaranteed accuracy.
  const e=events('2024-04-08T00:00:00Z',32.346975,-97.386246).find(e=>e.kind==='solar')!;
  expect(e.type).toBe('total');expect(e.peakKind).toBe('maximum');expect(e.risesJdUt).toEqual([]);expect(e.setsJdUt).toEqual([]);
  for(const[name,time]of Object.entries({partial_begins:'17:21:35.7',total_begins:'18:39:03.0',maximum:'18:40:54.8',total_ends:'18:42:48.6',partial_ends:'20:01:10.1'})){
   const at=name==='maximum'?e.visiblePeakJdUt:e.contacts.find(c=>c.name===name)!.jdUt;expect(Math.abs((at-jd('2024-04-08T'+time+'Z'))*86400)).toBeLessThan(60);
  }
 });
 it('retains NewYork total lunar phases at the2025March14 peak',()=>{const e=events('2025-03-14T00:00:00Z',40.7128,-74.006).find(e=>e.kind==='lunar')!;expect(e.type).toBe('total');expect(e.peakKind).toBe('maximum');expect(e.contacts).toHaveLength(6);expect(e.contacts.every(c=>c.visible)).toBe(true)});
 it('labels London lunar peak as a setting boundary and Sydney as a rising boundary',()=>{const a=events('2025-03-14T00:00:00Z',51.5074,-.1278).find(e=>e.kind==='lunar')!,b=events('2025-03-13T13:00:00Z',-33.8688,151.2093).find(e=>e.kind==='lunar')!;expect(a).toMatchObject({type:'partial',peakKind:'set_boundary',unclippedMaximumVisible:false});expect(b).toMatchObject({type:'partial',peakKind:'rise_boundary',unclippedMaximumVisible:false});expect(a.setsJdUt[0]).toBe(a.visiblePeakJdUt);expect(b.risesJdUt[0]).toBe(b.visiblePeakJdUt)});
 it('does not infer Delhi visibility from a global solar or lunar event',()=>{expect(events('2024-04-08T00:00:00Z',28.6139,77.209).some(e=>e.kind==='solar')).toBe(false);expect(events('2025-03-14T00:00:00Z',28.6139,77.209).some(e=>e.kind==='lunar')).toBe(false)});
 it.each([90,-90])('returns bounded polar results at latitude%s',lat=>{const e=events('2026-03-01T00:00:00Z',lat,0,31);expect(e.length).toBeLessThanOrEqual(4);expect(e.every(x=>Number.isFinite(x.visiblePeakJdUt))).toBe(true)});
});
