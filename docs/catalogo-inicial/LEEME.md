# Catálogo inicial de RawEnergy EC

Registro: tarea C14 de la [auditoría ecommerce](../auditoria-ecommerce.md). Responsable: Claude, a pedido del propietario (2026-09-26). Fuente única: `apps/api/src/data/initialCatalog.ts`. Este CSV se genera con `node --import tsx scripts/export-initial-catalog.mts`.

## Qué contiene

20 productos reales (dos por cada marca del portal) y 41 presentaciones, en [catalogo-rawenergy.csv](catalogo-rawenergy.csv), con el formato del importador del panel (**Productos → Importar Excel / CSV**). El archivo pasó el analizador del panel y la API en modo de prueba: 20 productos válidos. La prueba se hizo con identificadores temporales porque la demo local ya los contiene.

## Antes de importarlo a producción

1. **Precios:** son de referencia y deben confirmarse. No hay precio anterior ni descuentos.
2. **Existencias:** el archivo llega con **0 unidades**. Registra el inventario real en **Órdenes de compra** (costo, lote y vencimiento) para que se pueda vender.
3. **Etiquetas:** compara porción, sabores y valores nutricionales con el envase del lote que vendes. Una celda nutricional vacía significa que la etiqueta no la declara; la tienda muestra «No declarado». No la conviertas en 0.
4. **Fotos:** sube la foto real de cada presentación en el panel, o colócala en `apps/web/public/assets/products/<identificador>.webp`. Mientras falte, la tienda muestra el logo de la marca, nunca la foto de otro producto.
5. **Destacados:** marca con la estrella del panel los productos que quieras en portada.

## Productos, presentaciones y fuentes

| Marca | Producto | Identificador | Presentaciones (precio de referencia) | Fuentes |
| --- | --- | --- | --- | --- |
| Gold Standard | Gold Standard 100% Whey | `gold-standard-100-whey` | Double Rich Chocolate 2 lb ($59.90); Double Rich Chocolate 5 lb ($104.90); Vanilla Ice Cream 5 lb ($104.90) | [1](https://www.optimumnutrition.com/en-us/products/gold-standard-100-whey-protein-powder) [2](https://foods.fatsecret.com/calories-nutrition/optimum-nutrition/gold-standard-100%25-whey---double-rich-chocolate) |
| Dragon Pharma | Creatine Monohydrate | `dragon-pharma-creatine-monohydrate` | Sin sabor 300 g ($34.90) | [1](https://dragonpharmalabs.com/products/creatine-300g) [2](https://www.ultimatesportnutrition.us/products/dragon-pharma-creatine-monohydrate-300-grams) |
| Dragon Pharma | Iso Phorm | `dragon-pharma-iso-phorm` | Hot Chocolate 2 lb ($54.90); Cookies & Cream 2 lb ($54.90); Hot Chocolate 5 lb ($109.90) | [1](https://dragonpharmalabs.com/products/isophorm) [2](https://www.commonwealthnutrition.com/products/dragon-pharma-isophorm-protein-isolate) [3](https://fitia.app/calories-nutritional-information/iso-phorm-whey-protein-isolate-F656kh7jt6/) |
| Insane Labz | Psychotic Gold | `insane-labz-psychotic-gold` | Fruit Punch 35 porciones ($44.90); Grape 35 porciones ($44.90); Gummy Candy 35 porciones ($44.90) | [1](https://insanelabz.com/products/psychotic-gold/) |
| Insane Labz | Psychotic | `insane-labz-psychotic` | Fruit Punch 35 porciones ($42.90); Grape 35 porciones ($42.90) | [1](https://insanelabz.com/products/psychotic) [2](https://www.garagegymreviews.com/psychotic-pre-workout-review) |
| Gold Standard | Gold Standard 100% Isolate | `gold-standard-100-isolate` | Chocolate Bliss 3 lb ($99.90); Rich Vanilla 3 lb ($99.90) | [1](https://www.optimumnutrition.com/en-us/products/gold-standard-100-isolate-whey-protein-powder) [2](https://foods.fatsecret.com/calories-nutrition/optimum-nutrition/gold-standard-100-isolate) |
| Optimum Nutrition | Micronized Creatine Powder | `optimum-nutrition-micronized-creatine` | Sin sabor 300 g ($29.90); Sin sabor 600 g ($49.90) | [1](https://www.optimumnutrition.com/en-us/products/creatine-monohydrate-micronized-powder) |
| Optimum Nutrition | Serious Mass | `optimum-nutrition-serious-mass` | Chocolate 6 lb ($69.90); Vanilla 6 lb ($69.90); Chocolate 12 lb ($119.90) | [1](https://www.optimumnutrition.com/en-us/products/serious-mass-weight-gainer-protein-powder) |
| Dymatize | ISO100 Hydrolyzed | `dymatize-iso100` | Gourmet Chocolate 1.6 lb ($49.90); Gourmet Chocolate 5 lb ($119.90); Fudge Brownie 5 lb ($119.90) | [1](https://dymatize.com/products/iso100-gourmet-chocolate) [2](https://foods.fatsecret.com/calories-nutrition/dymatize-nutrition/iso-100-hydrolyzed-100%25-whey-protein-isolate---gourmet-chocolate) |
| Dymatize | Elite 100% Whey | `dymatize-elite-100-whey` | Rich Chocolate 2 lb ($49.90); Rich Chocolate 5 lb ($89.90) | [1](https://dymatize.com/products/elite-100-whey-rich-chocolate) [2](https://foods.fatsecret.com/calories-nutrition/dymatize-nutrition/elite-100-whey-protein-rich-chocolate) |
| MuscleTech | Nitro-Tech 100% Whey Gold | `muscletech-nitro-tech-whey-gold` | Double Rich Chocolate 5.5 lb ($99.90); Double Rich Chocolate 8 lb ($139.90) | [1](https://www.nutritionix.com/i/muscletech/nitro-tech-whey-gold-double-rich-chocolate/583d28628717ecae0dec6aaf) [2](https://www.iherb.com/pr/muscletech-nitro-tech-100-whey-gold-double-rich-chocolate-5-lbs-2-27-kg/77943) |
| MuscleTech | Platinum 100% Creatine | `muscletech-platinum-creatine` | Sin sabor 400 g ($32.90) | [1](https://www.muscletech.com/products/platinum-100-creatine) |
| Nutrex | Lipo-6 Black Ultra Concentrate | `nutrex-lipo-6-black-uc` | Cápsulas 60 cápsulas ($39.50) | [1](https://www.iherb.com/pr/nutrex-research-lipo-6-black-ultra-concentrate-60-liqui-caps/44780) |
| Nutrex | Outlift | `nutrex-outlift` | Fruit Punch 20 porciones ($44.90); Miami Vice 20 porciones ($44.90); Blueberry Lemonade 20 porciones ($44.90) | [1](https://www.bestpricenutrition.com/products/nutrex-research-outlift-20-servings) [2](https://barbend.com/nutrex-outlift-pre-workout-review/) |
| Evogen | EVP-3D | `evogen-evp-3d` | Strawberry Lemonade 40 porciones ($44.50); Peach Mango 40 porciones ($44.50) | [1](https://www.evogennutrition.com/products/evp-3d) |
| Evogen | IsoJect | `evogen-isoject` | Chocolate 2 lb ($64.90); Oatmeal Cookie 2 lb ($64.90) | [1](https://www.evogennutrition.com/products/isoject) [2](https://www.eatthismuch.com/calories/chocolate-ultra-pure-whey-isolate-protein-isoject-4053498) |
| Kevin Levrone | Anabolic Mass | `kevin-levrone-anabolic-mass` | Chocolate 3 kg ($69.90) | [1](https://levrosupplements.com/gb/kevin-levrone-black-line/30-anabolic-mass-3-kg.html) [2](https://www.fatsecret.co.in/calories-nutrition/kevin-levrone/anabolic-mass/100g) |
| Kevin Levrone | Levro Whey Supreme | `kevin-levrone-levro-whey-supreme` | Chocolate 2 kg ($74.90) | [1](https://levrosupplements.com/gb/kevin-levrone-silver-line/72-levro-whey-supreme-2-kg.html) [2](https://fitia.app/calories-nutritional-information/levro-whey-supreme-F6aogovg7d/) |
| Raw Nutrition | CBUM Thavage Pre-Workout | `raw-nutrition-cbum-thavage` | Peach Bum 40 medidas ($44.90); Rocket Candy 40 medidas ($44.90) | [1](https://www.coalitionnutrition.com/products/cbum-thavage-pre-workout) [2](https://barbend.com/cbum-thavage-pre-workout-review/) |
| Raw Nutrition | CBUM Itholate Protein | `raw-nutrition-cbum-itholate` | Vanilla Oatmeal Cookie 25 porciones ($59.90); Cinnamon Crunch Cereal 25 porciones ($59.90) | [1](https://www.coalitionnutrition.com/products/cbum-iso-protein) |

«Gold Standard» es la línea de Optimum Nutrition; se mantiene como marca propia porque así figura en el portal. Consultado el 2026-09-26. Los fabricantes cambian fórmulas y sabores: la etiqueta del envase prevalece.
