from PIL import Image
import numpy as np

source = Image.open('public/assets/supplied-sheet.png').convert('RGBA')
arr = np.array(source)

def check_clean(name, im):
    a = np.array(im)[:, :, 3]
    top = np.sum(a[0, :] > 5)
    bottom = np.sum(a[-1, :] > 5)
    left = np.sum(a[:, 0] > 5)
    right = np.sum(a[:, -1] > 5)
    total_pixels = np.sum(a > 10)
    if total_pixels == 0:
        print(f"ERROR: {name} is COMPLETELY EMPTY!")
        return False
    if top > 0 or bottom > 0 or left > 0 or right > 0:
        print(f"CLIPPED: {name:30s} top={top}, bottom={bottom}, left={left}, right={right}")
        return False
    return True

# We want crop_tight to add 2px of transparent padding around every sprite
def crop_tight(im, alpha_threshold=5, pad=2):
    alpha = im.getchannel('A')
    bbox = alpha.point(lambda v: 255 if v > alpha_threshold else 0).getbbox()
    if not bbox:
        return im
    # Pad within original crop boundaries if possible
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(im.width, bbox[2] + pad)
    bottom = min(im.height, bbox[3] + pad)
    cropped = im.crop((left, top, right, bottom))
    # If the bbox was at the edge of the crop, check_clean will catch it
    return cropped

crops = {}

# --- 1. HEROES ---
crops['hero-0.png'] = crop_tight(source.crop((10, 30, 156, 225)))
crops['hero-1.png'] = crop_tight(source.crop((158, 30, 290, 225)))
crops['hero-2.png'] = crop_tight(source.crop((292, 30, 420, 225)))
crops['hero-3.png'] = crop_tight(source.crop((422, 30, 550, 225)))

# Hero 4: keep full sleeve and outline up to 678, clean yellow aura
h4_arr = arr[35:225, 550:680].copy()
for y in range(h4_arr.shape[0]):
    for x in range(115, h4_arr.shape[1]): # relative to 550
        r, g, b, a = h4_arr[y, x]
        if a > 0:
            is_black = (r < 65 and g < 65 and b < 65)
            is_teal = (r < 75 and g > 70 and b > 70)
            if not (is_black or is_teal):
                h4_arr[y, x, 3] = 0
crops['hero-4.png'] = crop_tight(Image.fromarray(h4_arr))

# Hero 5 (Action Hero): x in [676, 887], y in [5, 235]
h5_arr = arr[5:235, 676:887].astype(float)
for x in range(12):
    for y in range(h5_arr.shape[0]):
        if h5_arr[y, x, 3] > 0 and (h5_arr[y, x, 0] < 140 or h5_arr[y, x, 1] < 110 or h5_arr[y, x, 2] > 140):
            h5_arr[y, x, 3] = 0
        else:
            h5_arr[y, x, 3] *= min(1.0, (x / 11.0) ** 1.2)
crops['hero-5.png'] = crop_tight(Image.fromarray(h5_arr.astype(np.uint8)))
crops['hero-action.png'] = crops['hero-5.png']

# --- 2. PROJECTILES & EFFECTS (TOP RIGHT) ---
crops['projectile-gold-1.png'] = crop_tight(source.crop((883, 10, 992, 105)))
crops['projectile-gold-2.png'] = crop_tight(source.crop((995, 10, 1110, 105)))
crops['projectile.png'] = crop_tight(source.crop((1112, 10, 1250, 132)))
crops['projectile-blue.png'] = crops['projectile.png']
crops['impact.png'] = crop_tight(source.crop((895, 125, 985, 245)))
crops['effect-impact-star.png'] = crops['impact.png']
crops['effect-shield-gold.png'] = crop_tight(source.crop((995, 120, 1135, 258)))
crops['effect-trail-gold.png'] = crop_tight(source.crop((1135, 125, 1252, 245)))

# --- 3. SMALL ENEMIES (ROW 2) ---
crops['enemy-shadow-0.png'] = crop_tight(source.crop((30, 240, 155, 415)))
crops['enemy-shadow-1.png'] = crop_tight(source.crop((170, 240, 305, 415)))
crops['enemy-shadow-2.png'] = crop_tight(source.crop((320, 240, 448, 415)))
crops['enemy-shadow-3.png'] = crop_tight(source.crop((465, 240, 598, 415)))
crops['enemy-pebble.png'] = crop_tight(source.crop((615, 240, 770, 415)))
crops['enemy-golem-3.png'] = crops['enemy-pebble.png']
crops['enemy-urchin.png'] = crop_tight(source.crop((778, 240, 924, 415)))
crops['enemy-specter.png'] = crop_tight(source.crop((930, 255, 1100, 415)))
crops['enemy-mushroom.png'] = crop_tight(source.crop((1100, 255, 1235, 415)))

# --- 4. SMALL ENEMY HITS & DEBRIS (ROW 3) ---
crops['hit-shadow.png'] = crop_tight(source.crop((25, 420, 130, 555)))
crops['effect-shadow-burst.png'] = crop_tight(source.crop((140, 420, 245, 555)))
crops['effect-shadow-splat.png'] = crop_tight(source.crop((255, 420, 355, 555)))
crops['hit-shadow-mask.png'] = crop_tight(source.crop((358, 420, 498, 555)))
crops['hit-pebble.png'] = crop_tight(source.crop((505, 420, 638, 556)))
crops['effect-rock-debris.png'] = crop_tight(source.crop((645, 420, 765, 555)))
crops['hit-urchin.png'] = crop_tight(source.crop((772, 420, 900, 555)))
crops['effect-crystal-shards-pink.png'] = crop_tight(source.crop((900, 420, 968, 555)))
crops['hit-specter.png'] = crop_tight(source.crop((975, 420, 1092, 555)))
crops['hit-mushroom.png'] = crop_tight(source.crop((1092, 420, 1230, 555)))

# --- 5. BOSSES (ROW 4) ---
crops['enemy-golem-1.png'] = crop_tight(source.crop((20, 555, 320, 805)))
crops['boss-tree-golem.png'] = crops['enemy-golem-1.png']
crops['enemy-golem-2.png'] = crop_tight(source.crop((335, 555, 615, 805)))
crops['boss-void-lord.png'] = crops['enemy-golem-2.png']
crops['enemy-golem-0.png'] = crop_tight(source.crop((620, 555, 915, 805)))
crops['boss-crystal-golem.png'] = crops['enemy-golem-0.png']

# --- 6. BOSS HITS & DEBRIS (ROW 4 RIGHT) ---
crops['hit-boss-tree.png'] = crop_tight(source.crop((930, 560, 1030, 675)))
crops['effect-boss-wood-debris.png'] = crop_tight(source.crop((930, 675, 1030, 805)))
crops['hit-boss-void.png'] = crop_tight(source.crop((1035, 560, 1135, 674)))
crops['effect-boss-void-debris.png'] = crop_tight(source.crop((1035, 675, 1135, 805)))
crops['hit-boss-crystal.png'] = crop_tight(source.crop((1138, 560, 1235, 675)))
crops['effect-boss-crystal-debris.png'] = crop_tight(source.crop((1138, 675, 1235, 805)))

# --- 7. PICKUPS & ITEMS (ROW 5) ---
crops['item-ring-gold.png'] = crop_tight(source.crop((30, 810, 130, 910)))
crops['item-ring-blue.png'] = crop_tight(source.crop((132, 810, 215, 910)))
crops['item-ring-purple.png'] = crop_tight(source.crop((220, 810, 300, 910)))
crops['item-ring-green.png'] = crop_tight(source.crop((302, 810, 385, 910)))
crops['item-gem-yellow.png'] = crop_tight(source.crop((430, 810, 505, 910)))
crops['item-gem-blue.png'] = crop_tight(source.crop((510, 810, 575, 910)))
crops['item-gem-red.png'] = crop_tight(source.crop((590, 810, 655, 910)))
crops['xp-coin.png'] = crop_tight(source.crop((685, 810, 765, 905)))
crops['item-rune-stone.png'] = crop_tight(source.crop((775, 810, 865, 910)))

# --- 8. TERRAIN TILES (ROW 6 LEFT) ---
crops['terrain-grass.png'] = source.crop((15, 915, 120, 1018))
crops['terrain-flowers.png'] = source.crop((120, 915, 225, 1018))
crops['terrain-grass-dark.png'] = source.crop((225, 915, 330, 1018))
crops['terrain-dirt.png'] = source.crop((330, 915, 435, 1018))
crops['terrain-sand.png'] = source.crop((435, 915, 540, 1018))
crops['terrain-stone.png'] = source.crop((540, 915, 645, 1018))
crops['terrain-water.png'] = source.crop((645, 915, 750, 1018))

# --- 9. PROPS & FOLIAGE (ROW 6 RIGHT) ---
crops['prop-tuft.png'] = crop_tight(source.crop((768, 920, 818, 1018)))
crops['prop-ground-flowers.png'] = crop_tight(source.crop((822, 920, 868, 1018)))
crops['prop-flowers.png'] = crop_tight(source.crop((870, 920, 915, 1018)))
crops['prop-bush-small.png'] = crop_tight(source.crop((916, 920, 978, 1018)))
crops['prop-bush.png'] = crop_tight(source.crop((978, 920, 1070, 1022)))

# Rock
rock_arr = arr[920:1020, 1070:1145].copy()
for y in range(920, 1020):
    for x in range(1070, 1145):
        if x > 1135 and y < 972:
            rock_arr[y-920, x-1070, 3] = 0
crops['prop-rock.png'] = crop_tight(Image.fromarray(rock_arr))

# Mushrooms
mush_arr = arr[920:1020, 1135:1205].copy()
for y in range(920, 1020):
    for x in range(1135, 1205):
        if x < 1145 and y >= 972:
            mush_arr[y-920, x-1135, 3] = 0
        if x >= 1198 and 950 <= y <= 965:
            mush_arr[y-920, x-1135, 3] = 0
crops['prop-mushrooms.png'] = crop_tight(Image.fromarray(mush_arr))

# Tall grass
grass_arr = arr[920:1020, 1200:1250].copy()
for y in range(920, 1020):
    for x in range(1200, 1250):
        r, g, b, a = grass_arr[y-920, x-1200]
        if r > g + 20:
            grass_arr[y-920, x-1200, 3] = 0
crops['prop-grass-tall.png'] = crop_tight(Image.fromarray(grass_arr))

# --- 10. BUILDINGS (ROW 7) ---
crops['building-house.png'] = crop_tight(source.crop((15, 1020, 275, 1245)))
crops['building-tower.png'] = crop_tight(source.crop((290, 1020, 498, 1245)))
crops['building-shrine.png'] = crop_tight(source.crop((505, 1020, 790, 1245)))
crops['building-well.png'] = crop_tight(source.crop((800, 1020, 975, 1245)))

fence_crop = arr[1060:1220, 990:1140].copy()
for y in range(1060, 1220):
    for x in range(990, 1140):
        if x > 1125 and y >= 1192:
            fence_crop[y-1060, x-990, 3] = 0
crops['building-fence.png'] = crop_tight(Image.fromarray(fence_crop))

lamppost_crop = arr[1020:1240, 1125:1235].copy()
for y in range(1020, 1240):
    for x in range(1125, 1235):
        if x < 1140 and y < 1192:
            lamppost_crop[y-1020, x-1125, 3] = 0
crops['building-lamppost.png'] = crop_tight(Image.fromarray(lamppost_crop))
crops['prop-lamppost.png'] = crops['building-lamppost.png']

print(f"Checking all {len(crops)} crops...")
errors = 0
for name, im in crops.items():
    if not name.startswith('terrain-'):
        if not check_clean(name, im):
            errors += 1

print(f"\nDone! Errors count: {errors}")
