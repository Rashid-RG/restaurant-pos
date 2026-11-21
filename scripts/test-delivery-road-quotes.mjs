import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryFeeCalculator } from '../lib/delivery/fee.js';
import { parseRoadRoute } from '../lib/road-routing.js';

const pickup = {storeLat: 7.99, storeLng: 80.26};
const destination = [7.991, 80.261];
const route = {distanceMeters: 5000, travelMinutes: 12};

function calculator(settings, getRoadRoute) {
  return createDeliveryFeeCalculator({
    getSettingsMap: async tenant => settings[tenant],
    isPeakHour: async () => false,
    getRoadRoute
  });
}

test('distance mode is tenant-specific and paid and free road quotes use the same distance', async () => {
  const quote = calculator({road: {...pickup, deliveryDistanceMode: 'road'}, radius: pickup}, async () => route);
  const paid = await quote(...destination, 1800, 'road');
  assert.equal(paid.totalFee, 249);
  assert.equal(paid.distanceMode, 'road');
  assert.equal(paid.distanceKm, 5);
  assert.equal(paid.etaMinutes, 22);
  assert.equal((await quote(...destination, 3000, 'road')).totalFee, 0);
  assert.equal((await quote(...destination, 1800, 'radius')).totalFee, 99);
});

test('road coverage uses the unrounded distance even for free delivery', async () => {
  const quote = calculator({shop: {...pickup, deliveryDistanceMode:'road',deliveryMaxRadiusKm:5}}, async () => ({...route,distanceMeters:5001}));
  assert.equal((await quote(...destination, 3000, 'shop')).isOutOfRange, true);
});

test('provider failure is distinct from outside coverage and a missing shop pin', async () => {
  const quote = calculator({shop:{...pickup,deliveryDistanceMode:'road'},missing:{}}, async () => null);
  await assert.rejects(quote(...destination,1800,'shop'), {code:'DELIVERY_ROUTE_UNAVAILABLE',status:503});
  await assert.rejects(quote(...destination,1800,'missing'), {code:'STORE_DELIVERY_LOCATION_MISSING'});
});

test('pricing rejects a route that snaps too far from the entrance', () => {
  const payload = {code:'Ok',routes:[{distance:1000,duration:120,geometry:{type:'LineString',coordinates:[[80.26,7.99],[80.261,7.991]]}}]};
  const endpoints = {from:{lat:7.992,lng:80.26},to:{lat:7.991,lng:80.261}};
  assert.ok(parseRoadRoute(payload,endpoints));
  assert.equal(parseRoadRoute(payload,{...endpoints,maxSnapMeters:100}),null);
});
