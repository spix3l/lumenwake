from pathlib import Path
from PIL import Image
import numpy as np

source_path = Path('public/assets/supplied-sheet.png')
output_dir = Path('public/assets/game')
output_dir.mkdir(parents=True, exist_ok=True)

source = Image.open(source_path).convert('RGBA')
arr = np.array(source)

def crop_tight(im, alpha_threshold=8, pad=2):
    """
    Tightly crops an image to its non-transparent content (ignoring faint noise below alpha_threshold)
    and places it centered onto a canvas with `pad` pixels of pure transparent padding on all sides.
    This guarantees no sprite touches the image edge while preserving full pixel integrity.
    """
    alpha = im.getchannel('A')
    bbox = alpha.point(lambda v: 255 if v > alpha_threshold else 0).getbbox()
    if not bbox:
        return im
    content = im.crop(bbox)
    padded = Image.new('RGBA', (content.width + pad * 2, content.height + pad * 2), (0, 0, 0, 0))
    padded.paste(content, (pad, pad))
    return padded

# Dictionary of sprite crops: filename -> PIL Image
crops = {}

# ==============================================================================
# CATEGORY 1: HEROES (ROW 1 LEFT)
# ==============================================================================
crops['hero-0.png'] = crop_tight(source.crop((10, 30, 156, 225)))
crops['hero-1.png'] = crop_tight(source.crop((158, 30, 290, 225)))
crops['hero-2.png'] = crop_tight(source.crop((292, 30, 420, 225)))
crops['hero-3.png'] = crop_tight(source.crop((422, 30, 548, 225)))

# Hero 4: Full bounds (550..680, 35..225). Preserve right cloak/elbow while removing Hero 5 yellow aura
h4_arr = arr[35:225, 550:680].copy()
for y in range(h4_arr.shape[0]):
    for x in range(h4_arr.shape[1]):
        x_sheet = 550 + x
        if x_sheet > 677:
            h4_arr[y, x, 3] = 0
        elif x_sheet >= 665:
            r, g, b, a = h4_arr[y, x]
            # Aura is bright gold/yellow (high R, high G, lower B)
            if r > 100 and g > 90 and b < 140 and (int(r) - int(b) > 20):
                h4_arr[y, x, 3] = 0
crops['hero-4.png'] = crop_tight(Image.fromarray(h4_arr))

# Hero 5 (Action Hero): Aura starts around 676; softly feather left aura edge, remove dark cloak remnants
h5_arr = arr[5:235, 676:888].astype(float)
for x in range(12):
    for y in range(h5_arr.shape[0]):
        if h5_arr[y, x, 3] > 0 and (h5_arr[y, x, 0] < 140 or h5_arr[y, x, 1] < 110 or h5_arr[y, x, 2] > 140):
            h5_arr[y, x, 3] = 0
        else:
            h5_arr[y, x, 3] *= min(1.0, (x / 11.0) ** 1.2)
crops['hero-5.png'] = crop_tight(Image.fromarray(h5_arr.astype(np.uint8)))
crops['hero-action.png'] = crops['hero-5.png']

# ==============================================================================
# CATEGORY 2: PROJECTILES & EFFECTS (ROW 1 RIGHT)
# ==============================================================================
crops['projectile-gold-1.png'] = crop_tight(source.crop((883, 10, 992, 115)))
crops['projectile-gold-2.png'] = crop_tight(source.crop((995, 10, 1112, 115)))
crops['projectile.png'] = crop_tight(source.crop((1112, 10, 1250, 135)))
crops['projectile-blue.png'] = crops['projectile.png']
crops['impact.png'] = crop_tight(source.crop((890, 120, 990, 245)))
crops['effect-impact-star.png'] = crops['impact.png']
crops['effect-shield-gold.png'] = crop_tight(source.crop((995, 128, 1135, 258)))
crops['effect-trail-gold.png'] = crop_tight(source.crop((1138, 140, 1250, 245)))

# ==============================================================================
# CATEGORY 3: SMALL ENEMIES (ROW 2)
# ==============================================================================
crops['enemy-shadow-0.png'] = crop_tight(source.crop((25, 240, 155, 415)))
crops['enemy-shadow-1.png'] = crop_tight(source.crop((165, 240, 310, 415)))
crops['enemy-shadow-2.png'] = crop_tight(source.crop((320, 240, 455, 415)))
crops['enemy-shadow-3.png'] = crop_tight(source.crop((460, 240, 600, 415)))
crops['enemy-pebble.png'] = crop_tight(source.crop((610, 240, 775, 415)))
crops['enemy-golem-3.png'] = crops['enemy-pebble.png']
crops['enemy-urchin.png'] = crop_tight(source.crop((778, 240, 925, 415)))
crops['enemy-specter.png'] = crop_tight(source.crop((930, 260, 1098, 415)))
crops['enemy-mushroom.png'] = crop_tight(source.crop((1100, 260, 1235, 415)))

# ==============================================================================
# CATEGORY 4: SMALL ENEMY HITS & DEBRIS (ROW 3)
# ==============================================================================
crops['hit-shadow.png'] = crop_tight(source.crop((25, 420, 130, 555)))
crops['effect-shadow-burst.png'] = crop_tight(source.crop((140, 420, 245, 555)))
crops['effect-shadow-splat.png'] = crop_tight(source.crop((255, 420, 355, 555)))
crops['hit-shadow-mask.png'] = crop_tight(source.crop((355, 420, 498, 555)))
crops['hit-pebble.png'] = crop_tight(source.crop((505, 420, 638, 556)))
crops['effect-rock-debris.png'] = crop_tight(source.crop((645, 420, 765, 555)))
crops['hit-urchin.png'] = crop_tight(source.crop((772, 420, 900, 555)))
crops['effect-crystal-shards-pink.png'] = crop_tight(source.crop((900, 420, 968, 555)))
crops['hit-specter.png'] = crop_tight(source.crop((975, 420, 1092, 555)))
crops['hit-mushroom.png'] = crop_tight(source.crop((1092, 420, 1230, 555)))

# ==============================================================================
# CATEGORY 5: BOSSES (ROW 4 LEFT)
# ==============================================================================
crops['enemy-golem-1.png'] = crop_tight(source.crop((20, 560, 325, 805)))
crops['boss-tree-golem.png'] = crops['enemy-golem-1.png']
crops['enemy-golem-2.png'] = crop_tight(source.crop((335, 556, 615, 805)))
crops['boss-void-lord.png'] = crops['enemy-golem-2.png']
crops['enemy-golem-0.png'] = crop_tight(source.crop((620, 560, 915, 805)))
crops['boss-crystal-golem.png'] = crops['enemy-golem-0.png']

# ==============================================================================
# CATEGORY 6: BOSS HITS & DEBRIS (ROW 4 RIGHT)
# ==============================================================================
crops['hit-boss-tree.png'] = crop_tight(source.crop((930, 565, 1030, 680)))
crops['effect-boss-wood-debris.png'] = crop_tight(source.crop((930, 680, 1030, 805)))
crops['hit-boss-void.png'] = crop_tight(source.crop((1035, 565, 1135, 675)))
crops['effect-boss-void-debris.png'] = crop_tight(source.crop((1035, 675, 1135, 805)))
crops['hit-boss-crystal.png'] = crop_tight(source.crop((1138, 565, 1235, 685)))
crops['effect-boss-crystal-debris.png'] = crop_tight(source.crop((1138, 685, 1235, 805)))

# ==============================================================================
# CATEGORY 7: PICKUPS & ITEMS (ROW 5)
# ==============================================================================
crops['item-ring-gold.png'] = crop_tight(source.crop((30, 810, 130, 910)))
crops['item-ring-blue.png'] = crop_tight(source.crop((132, 810, 215, 910)))
crops['item-ring-purple.png'] = crop_tight(source.crop((220, 810, 300, 910)))
crops['item-ring-green.png'] = crop_tight(source.crop((302, 810, 385, 910)))
crops['item-gem-yellow.png'] = crop_tight(source.crop((430, 810, 505, 910)))
crops['item-gem-blue.png'] = crop_tight(source.crop((510, 810, 575, 910)))
crops['item-gem-red.png'] = crop_tight(source.crop((590, 810, 655, 910)))
crops['xp-coin.png'] = crop_tight(source.crop((685, 810, 765, 905)))
crops['item-rune-stone.png'] = crop_tight(source.crop((775, 810, 865, 910)))

# ==============================================================================
# CATEGORY 8: TERRAIN TILES (ROW 6 LEFT)
# ==============================================================================
# Standard 105x103 tile modules
crops['terrain-grass.png'] = source.crop((15, 915, 120, 1018))
crops['terrain-flowers.png'] = source.crop((120, 915, 225, 1018))
crops['terrain-grass-dark.png'] = source.crop((225, 915, 330, 1018))
crops['terrain-dirt.png'] = source.crop((330, 915, 435, 1018))
crops['terrain-sand.png'] = source.crop((435, 915, 540, 1018))
crops['terrain-stone.png'] = source.crop((540, 915, 645, 1018))
crops['terrain-water.png'] = source.crop((645, 915, 750, 1018))

# ==============================================================================
# CATEGORY 9: PROPS & FOLIAGE (ROW 6 RIGHT)
# ==============================================================================
crops['prop-tuft.png'] = crop_tight(source.crop((765, 920, 820, 1018)))
crops['prop-ground-flowers.png'] = crop_tight(source.crop((822, 920, 868, 1018)))
crops['prop-flowers.png'] = crop_tight(source.crop((868, 920, 914, 1018)))
crops['prop-bush-small.png'] = crop_tight(source.crop((915, 920, 978, 1018)))
crops['prop-bush.png'] = crop_tight(source.crop((979, 920, 1070, 1020)))
crops['prop-rock.png'] = crop_tight(source.crop((1070, 935, 1148, 1018)))

# Mushrooms vs tall grass separation
mush_crop = arr[925:1018, 1148:1201].copy()
for y in range(mush_crop.shape[0]):
    for x in range(mush_crop.shape[1]):
        x_sheet = 1148 + x
        if x_sheet >= 1200:
            r, g, b, a = mush_crop[y, x]
            if int(g) > int(r) + 15:
                mush_crop[y, x, 3] = 0
crops['prop-mushrooms.png'] = crop_tight(Image.fromarray(mush_crop))

grass_crop = arr[925:1018, 1201:1250].copy()
for y in range(grass_crop.shape[0]):
    for x in range(grass_crop.shape[1]):
        r, g, b, a = grass_crop[y, x]
        if int(r) > int(g) + 20 and r > 120:
            grass_crop[y, x, 3] = 0
crops['prop-grass-tall.png'] = crop_tight(Image.fromarray(grass_crop))

# ==============================================================================
# CATEGORY 10: BUILDINGS (ROW 7)
# ==============================================================================
crops['building-house.png'] = crop_tight(source.crop((15, 1020, 275, 1245)))
crops['building-tower.png'] = crop_tight(source.crop((290, 1020, 498, 1245)))
crops['building-shrine.png'] = crop_tight(source.crop((505, 1020, 790, 1245)))
crops['building-well.png'] = crop_tight(source.crop((800, 1020, 975, 1245)))

# Fence and lamppost clean separation
fence_crop = arr[1060:1220, 990:1145].copy()
for y in range(1060, 1220):
    for x in range(990, 1145):
        if x >= 1142 or (y >= 1192 and x >= 1125):
            fence_crop[y - 1060, x - 990, 3] = 0
crops['building-fence.png'] = crop_tight(Image.fromarray(fence_crop))

lamppost_crop = arr[1020:1240, 1125:1235].copy()
for y in range(1020, 1240):
    for x in range(1125, 1235):
        if y < 1192 and x < 1142:
            lamppost_crop[y - 1020, x - 1125, 3] = 0
crops['building-lamppost.png'] = crop_tight(Image.fromarray(lamppost_crop))
crops['prop-lamppost.png'] = crops['building-lamppost.png']

print(f"Total sprites defined: {len(crops)}")

for filename, img in crops.items():
    dest = output_dir / filename
    img.save(dest, optimize=True)
    print(f"Saved: {filename:32s} size={img.size}")

print(f"\nAll {len(crops)} sprites successfully saved to {output_dir}")
