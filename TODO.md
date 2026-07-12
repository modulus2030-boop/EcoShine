# TODO — EcoShine Customer Dashboard Booking Wizard Premium Upgrade

## Step 1 — Repo understanding check
- [x] Reviewed `dashboard.html` embedded booking wizard markup + logic.
- [x] Reviewed current vehicle/promo/price calculation + Leaflet map + tracking.

## Step 2 — Fix broken DOM structure
- [x] Remove duplicated `wizard-step-2` block in `dashboard.html` so IDs and event listeners remain consistent.


## Step 3 — Implement real horizontal sliding wizard UI
- [x] Add a step-slider container (overflow hidden) and place step panes in a horizontal track.
- [x] Update `showStep(step)` to animate slider translateX and keep progress indicators in sync.
- [x] Add/adjust CSS transitions for the slider in `css/custom-animations.css` or inline in `dashboard.html` as needed.



## Step 4 — Vehicle type visual cards polish
- [ ] Ensure each vehicle card displays:
  - stylized silhouette/icon
  - vehicle class name
  - “Estimated Base Price” tag
  - “Nearest washer: X min away” proximity tag
- [ ] Ensure selection uses Eco green border highlight and `transform: scale(1.03)` hover/active states.

## Step 5 — Promo accordion behavior + price breakdown math
- [ ] Wire `#promo-toggle` accordion open/close.
- [ ] On promo apply: show micro success message, update breakdown discount row visibility.
- [ ] Ensure breakdown shows: Base Rate + Distance Fee - Discount = Total Price.

## Step 6 — Map marker transitions & custom washer markers
- [ ] Confirm Leaflet attribution is fully hidden (`attributionControl:false` + CSS).
- [ ] Harden geolocation marker drop animation reliability on every animate update.
- [ ] Ensure washer marker is custom and only created/updated once booking status reaches `Assigned`.
- [ ] Smooth washer marker movement when liveLocations updates (interpolate between last and new coordinates).

## Step 7 — Validate
- [ ] Load `dashboard.html` and manually verify: step slider, vehicle selection, promo drawer, booking request button flow.
- [ ] Verify live tracking: washer marker custom icon + smooth movement after Assigned.

