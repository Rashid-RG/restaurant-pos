# GastroFlow Food location-based restaurant discovery

## 1. Find restaurants for the customer’s location
The general customer link opens Stores. A saved GPS fix, selected address result or map pin starts in Delivery. Without a precise location, the customer can browse Pickup and choose an address later. A restaurant-specific link continues to open that restaurant. A city choice can rank pickup by approximate distance.

## 2. Explain availability at the point of selection
Delivery lists open restaurants with a positive server coverage result for the selected coordinates. Pickup lists open restaurants, closest first when coordinates are known. All stores supports browsing closed restaurants. Cards show separate delivery and pickup labels. Replacing an address invalidates the previous coverage result. The current restaurant configuration treats an open online store as accepting takeaway.

## 3. Carry fulfilment through the ordering journey
Next, carry the selected mode and confirmed pin from discovery through dishes, menu, cart and checkout. Refresh each restaurant’s quote before submission. Offer pickup when delivery becomes unavailable and let the customer confirm the switch. Add independent restaurant-managed pickup and delivery switches across store setup, the public listing and order acceptance.

## 4. Validate a commercial rollout
Use two staging restaurants with overlapping service areas and one closed restaurant. Test exact boundary pins, an unknown store location, denied GPS, manual address selection, moving a pin during a slow request and returning after a restaurant closes. Verify delivery, pickup and cross-restaurant isolation through POS acknowledgement. Repeat on iPhone Safari, installed iPhone web app and Android. Record first-result latency for cold and warm loads before expanding the pilot.
