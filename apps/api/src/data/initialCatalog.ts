import type { ProductPayload } from "../validation/product.js";

// Catálogo inicial de RawEnergy EC: productos reales, dos por marca del portal.
// Nombres, presentaciones, sabores y valores por porción provienen de las fuentes
// de `catalogSources` (fabricante o transcripción de la etiqueta). `null` = la
// etiqueta no declara ese valor. Revisar siempre contra el envase del lote vendido.
// PRECIOS: referencia para la demo, pendientes de confirmación del propietario.
// EXISTENCIAS: las de aquí son solo para la demo en memoria; el CSV de producción
// sale con 0 y el inventario real entra por Órdenes de compra (costo y lote).
// Sin fotos: cada producto espera su fotografía real (panel o /assets/products/<slug>).

// Mismos nombres que el selector de objetivos del panel (el panel y el importador
// derivan el identificador del nombre). La tienda muestra su propia etiqueta.
type Goal = { name: string; slug: string };
const goal = {
  muscle: { name: "Desarrollo Muscular", slug: "desarrollo-muscular" },
  energy: { name: "Energia", slug: "energia" },
  recovery: { name: "Recuperacion", slug: "recuperacion" },
  weight: { name: "Perdida de grasa", slug: "perdida-de-grasa" }
} satisfies Record<string, Goal>;
const category = {
  whey: { name: "Proteína whey", slug: "proteina-whey" },
  isolate: { name: "Proteína aislada", slug: "proteina-aislada" },
  creatine: { name: "Creatina", slug: "creatina" },
  pre: { name: "Preentreno", slug: "preentreno" },
  gainer: { name: "Ganador de peso", slug: "ganador-de-peso" },
  thermo: { name: "Termogénico", slug: "termogenico" }
};
const storeBadges = ["Express 4 h en Quito y Valles", "Envío nacional en 24 a 48 horas", "Producto original"];
const undeclared = (servingSize: string) => ({ servingSize, calories: null, protein: null, carbohydrates: null, fats: null });
const caffeineWarning = "Alto contenido de cafeína: no apto para menores de 18 años, embarazadas, en lactancia ni personas sensibles a estimulantes. No superes la dosis de la etiqueta.";

type Variant = { flavor: string; size: { value: number; unit: string }; price: number; stock: number; sku: string };
const product = (data: Omit<ProductPayload, "vitalCoinsReward" | "maxInstallments" | "hasFreeShipping" | "storeBadges" | "productType" | "variants"> & { variants: Variant[] }): ProductPayload => ({
  ...data, productType: "SUPPLEMENT", vitalCoinsReward: 0, maxInstallments: 1, hasFreeShipping: false, storeBadges,
  variants: data.variants.map(variant => ({ ...variant, compareAtPrice: null, reorderPoint: 3, images: [] }))
});

export const initialCatalog: ProductPayload[] = [
  // Posiciones 0 y 1: las pruebas de la API usan estos SKU y precios.
  product({
    title: "Gold Standard 100% Whey", brand: "Gold Standard", slug: "gold-standard-100-whey", featured: true,
    shortDescription: "Proteína de suero de Optimum Nutrition con aislado como ingrediente principal. 24 g de proteína y 120 kcal por porción de 30,4 g, según la etiqueta del fabricante.",
    nutritionalFacts: { servingSize: "1 medida (30,4 g)", calories: 120, protein: 24, carbohydrates: 3, fats: 1 },
    categories: [category.whey], goals: [goal.muscle, goal.recovery],
    variants: [
      { flavor: "Double Rich Chocolate", size: { value: 2, unit: "lb" }, price: 59.9, stock: 18, sku: "GS-WHEY-CHOC-2LB" },
      { flavor: "Double Rich Chocolate", size: { value: 5, unit: "lb" }, price: 104.9, stock: 10, sku: "GS-WHEY-CHOC-5LB" },
      { flavor: "Vanilla Ice Cream", size: { value: 5, unit: "lb" }, price: 104.9, stock: 9, sku: "GS-WHEY-VAN-5LB" }
    ]
  }),
  product({
    title: "Creatine Monohydrate", brand: "Dragon Pharma", slug: "dragon-pharma-creatine-monohydrate", featured: true,
    shortDescription: "Creatina monohidratada micronizada sin sabor: 5 g por porción y 60 porciones por envase de 300 g, según el fabricante.",
    nutritionalFacts: undeclared("1 medida (5 g)"),
    categories: [category.creatine], goals: [goal.muscle],
    variants: [{ flavor: "Sin sabor", size: { value: 300, unit: "g" }, price: 34.9, stock: 41, sku: "DP-CREATINE-300G" }]
  }),
  product({
    title: "Iso Phorm", brand: "Dragon Pharma", slug: "dragon-pharma-iso-phorm", featured: true,
    shortDescription: "Proteína de suero aislada e hidrolizada, sin azúcar añadida según el fabricante. 25 g de proteína y 110 kcal por porción de 30,4 g.",
    nutritionalFacts: { servingSize: "1 medida (30,4 g)", calories: 110, protein: 25, carbohydrates: null, fats: null },
    categories: [category.isolate], goals: [goal.muscle, goal.recovery],
    variants: [
      { flavor: "Hot Chocolate", size: { value: 2, unit: "lb" }, price: 54.9, stock: 12, sku: "DP-ISOPHORM-CHOC-2LB" },
      { flavor: "Cookies & Cream", size: { value: 2, unit: "lb" }, price: 54.9, stock: 8, sku: "DP-ISOPHORM-CYC-2LB" },
      { flavor: "Hot Chocolate", size: { value: 5, unit: "lb" }, price: 109.9, stock: 6, sku: "DP-ISOPHORM-CHOC-5LB" }
    ]
  }),
  product({
    title: "Psychotic Gold", brand: "Insane Labz", slug: "insane-labz-psychotic-gold", featured: true,
    shortDescription: `Preentreno con 325 mg de cafeína por porción según el fabricante, beta-alanina y citrulina. ${caffeineWarning}`,
    nutritionalFacts: undeclared("1 medida"),
    categories: [category.pre], goals: [goal.energy],
    variants: [
      { flavor: "Fruit Punch", size: { value: 35, unit: "porciones" }, price: 44.9, stock: 14, sku: "IL-PSYGOLD-FP-35" },
      { flavor: "Grape", size: { value: 35, unit: "porciones" }, price: 44.9, stock: 10, sku: "IL-PSYGOLD-GRAPE-35" },
      { flavor: "Gummy Candy", size: { value: 35, unit: "porciones" }, price: 44.9, stock: 7, sku: "IL-PSYGOLD-GUMMY-35" }
    ]
  }),
  product({
    title: "Psychotic", brand: "Insane Labz", slug: "insane-labz-psychotic", featured: false,
    shortDescription: `Preentreno de alta estimulación con beta-alanina, creatina y cerca de 400 mg de cafeína por medida de 6,8 g. ${caffeineWarning}`,
    nutritionalFacts: undeclared("1 medida (6,8 g)"),
    categories: [category.pre], goals: [goal.energy],
    variants: [
      { flavor: "Fruit Punch", size: { value: 35, unit: "porciones" }, price: 42.9, stock: 9, sku: "IL-PSYCHOTIC-FP-35" },
      { flavor: "Grape", size: { value: 35, unit: "porciones" }, price: 42.9, stock: 6, sku: "IL-PSYCHOTIC-GRAPE-35" }
    ]
  }),
  product({
    title: "Gold Standard 100% Isolate", brand: "Gold Standard", slug: "gold-standard-100-isolate", featured: false,
    shortDescription: "Proteína de suero 100 % aislada de Optimum Nutrition: 25 g de proteína, 1 g de carbohidratos y 0,5 g de grasa por porción de 31 g, según el fabricante.",
    nutritionalFacts: { servingSize: "1 medida (31 g)", calories: 110, protein: 25, carbohydrates: 1, fats: 0.5 },
    categories: [category.isolate], goals: [goal.muscle, goal.recovery],
    variants: [
      { flavor: "Chocolate Bliss", size: { value: 3, unit: "lb" }, price: 99.9, stock: 7, sku: "GS-ISO-CHOC-3LB" },
      { flavor: "Rich Vanilla", size: { value: 3, unit: "lb" }, price: 99.9, stock: 5, sku: "GS-ISO-VAN-3LB" }
    ]
  }),
  product({
    title: "Micronized Creatine Powder", brand: "Optimum Nutrition", slug: "optimum-nutrition-micronized-creatine", featured: false,
    shortDescription: "Creatina monohidratada micronizada sin sabor, 5 g por porción. Se mezcla con agua, jugo o tu batido de proteína.",
    nutritionalFacts: undeclared("1 cucharadita colmada (5 g)"),
    categories: [category.creatine], goals: [goal.muscle],
    variants: [
      { flavor: "Sin sabor", size: { value: 300, unit: "g" }, price: 29.9, stock: 20, sku: "ON-CREATINE-300G" },
      { flavor: "Sin sabor", size: { value: 600, unit: "g" }, price: 49.9, stock: 11, sku: "ON-CREATINE-600G" }
    ]
  }),
  product({
    title: "Serious Mass", brand: "Optimum Nutrition", slug: "optimum-nutrition-serious-mass", featured: false,
    shortDescription: "Ganador de peso: 1.250 kcal, 50 g de proteína y 252 g de carbohidratos por porción de dos medidas colmadas (340 g), según el fabricante.",
    nutritionalFacts: { servingSize: "2 medidas colmadas (340 g)", calories: 1250, protein: 50, carbohydrates: 252, fats: null },
    categories: [category.gainer], goals: [goal.muscle],
    variants: [
      { flavor: "Chocolate", size: { value: 6, unit: "lb" }, price: 69.9, stock: 10, sku: "ON-SMASS-CHOC-6LB" },
      { flavor: "Vanilla", size: { value: 6, unit: "lb" }, price: 69.9, stock: 6, sku: "ON-SMASS-VAN-6LB" },
      { flavor: "Chocolate", size: { value: 12, unit: "lb" }, price: 119.9, stock: 4, sku: "ON-SMASS-CHOC-12LB" }
    ]
  }),
  product({
    title: "ISO100 Hydrolyzed", brand: "Dymatize", slug: "dymatize-iso100", featured: false,
    shortDescription: "Proteína de suero aislada e hidrolizada: 25 g de proteína y 120 kcal por porción de 32 g, según la etiqueta.",
    nutritionalFacts: { servingSize: "1 medida (32 g)", calories: 120, protein: 25, carbohydrates: 2, fats: 0.5 },
    categories: [category.isolate], goals: [goal.recovery, goal.muscle],
    variants: [
      { flavor: "Gourmet Chocolate", size: { value: 1.6, unit: "lb" }, price: 49.9, stock: 12, sku: "DYM-ISO100-CHOC-1.6LB" },
      { flavor: "Gourmet Chocolate", size: { value: 5, unit: "lb" }, price: 119.9, stock: 6, sku: "DYM-ISO100-CHOC-5LB" },
      { flavor: "Fudge Brownie", size: { value: 5, unit: "lb" }, price: 119.9, stock: 4, sku: "DYM-ISO100-FUDGE-5LB" }
    ]
  }),
  product({
    title: "Elite 100% Whey", brand: "Dymatize", slug: "dymatize-elite-100-whey", featured: false,
    shortDescription: "Proteína de suero concentrada y aislada: 25 g de proteína y 140 kcal por porción de 36 g, según la etiqueta.",
    nutritionalFacts: { servingSize: "1 medida (36 g)", calories: 140, protein: 25, carbohydrates: 3, fats: 3 },
    categories: [category.whey], goals: [goal.muscle],
    variants: [
      { flavor: "Rich Chocolate", size: { value: 2, unit: "lb" }, price: 49.9, stock: 9, sku: "DYM-ELITE-CHOC-2LB" },
      { flavor: "Rich Chocolate", size: { value: 5, unit: "lb" }, price: 89.9, stock: 7, sku: "DYM-ELITE-CHOC-5LB" }
    ]
  }),
  product({
    title: "Nitro-Tech 100% Whey Gold", brand: "MuscleTech", slug: "muscletech-nitro-tech-whey-gold", featured: false,
    shortDescription: "Proteína de suero con péptidos y aislado: 24 g de proteína y 120 kcal por porción de 33 g, según la etiqueta.",
    nutritionalFacts: { servingSize: "1 medida (33 g)", calories: 120, protein: 24, carbohydrates: 2, fats: 2 },
    categories: [category.whey], goals: [goal.muscle],
    variants: [
      { flavor: "Double Rich Chocolate", size: { value: 5.5, unit: "lb" }, price: 99.9, stock: 8, sku: "MT-NITRO-CHOC-5.5LB" },
      { flavor: "Double Rich Chocolate", size: { value: 8, unit: "lb" }, price: 139.9, stock: 4, sku: "MT-NITRO-CHOC-8LB" }
    ]
  }),
  product({
    title: "Platinum 100% Creatine", brand: "MuscleTech", slug: "muscletech-platinum-creatine", featured: false,
    shortDescription: "Creatina monohidratada micronizada sin sabor, 5 g por porción y 80 porciones por envase de 400 g.",
    nutritionalFacts: undeclared("1 medida (5 g)"),
    categories: [category.creatine], goals: [goal.muscle],
    variants: [{ flavor: "Sin sabor", size: { value: 400, unit: "g" }, price: 32.9, stock: 16, sku: "MT-PLATINUM-CREATINE-400G" }]
  }),
  product({
    title: "Lipo-6 Black Ultra Concentrate", brand: "Nutrex", slug: "nutrex-lipo-6-black-uc", featured: false,
    shortDescription: `Cápsulas termogénicas con 200 mg de cafeína por cápsula, sinefrina y yohimbina, según el fabricante. ${caffeineWarning}`,
    nutritionalFacts: undeclared("1 cápsula"),
    categories: [category.thermo], goals: [goal.weight, goal.energy],
    variants: [{ flavor: "Cápsulas", size: { value: 60, unit: "cápsulas" }, price: 39.5, stock: 15, sku: "NUT-LIPO6-UC-60" }]
  }),
  product({
    title: "Outlift", brand: "Nutrex", slug: "nutrex-outlift", featured: false,
    shortDescription: `Preentreno con 8 g de citrulina malato, 3,2 g de beta-alanina, 3 g de creatina y 350 mg de cafeína por porción de 25,2 g. ${caffeineWarning}`,
    nutritionalFacts: undeclared("1 medida (25,2 g)"),
    categories: [category.pre], goals: [goal.energy],
    variants: [
      { flavor: "Fruit Punch", size: { value: 20, unit: "porciones" }, price: 44.9, stock: 8, sku: "NUT-OUTLIFT-FP-20" },
      { flavor: "Miami Vice", size: { value: 20, unit: "porciones" }, price: 44.9, stock: 6, sku: "NUT-OUTLIFT-MV-20" },
      { flavor: "Blueberry Lemonade", size: { value: 20, unit: "porciones" }, price: 44.9, stock: 5, sku: "NUT-OUTLIFT-BL-20" }
    ]
  }),
  product({
    title: "EVP-3D", brand: "Evogen", slug: "evogen-evp-3d", featured: false,
    shortDescription: "Preentreno sin cafeína ni estimulantes, con citrulina, beta-alanina y creatina. Una opción si entrenas de noche o evitas la cafeína.",
    nutritionalFacts: undeclared("1 medida (11,6 g)"),
    categories: [category.pre], goals: [goal.energy],
    variants: [
      { flavor: "Strawberry Lemonade", size: { value: 40, unit: "porciones" }, price: 44.5, stock: 10, sku: "EVO-EVP3D-SL-40" },
      { flavor: "Peach Mango", size: { value: 40, unit: "porciones" }, price: 44.5, stock: 7, sku: "EVO-EVP3D-PM-40" }
    ]
  }),
  product({
    title: "IsoJect", brand: "Evogen", slug: "evogen-isoject", featured: false,
    shortDescription: "Proteína de suero aislada con enzimas digestivas añadidas: 25 g de proteína y 110 kcal por porción de 32 g, según la etiqueta.",
    nutritionalFacts: { servingSize: "1 medida (32 g)", calories: 110, protein: 25, carbohydrates: 2, fats: 0.5 },
    categories: [category.isolate], goals: [goal.recovery, goal.muscle],
    variants: [
      { flavor: "Chocolate", size: { value: 2, unit: "lb" }, price: 64.9, stock: 8, sku: "EVO-ISOJECT-CHOC-2LB" },
      { flavor: "Oatmeal Cookie", size: { value: 2, unit: "lb" }, price: 64.9, stock: 5, sku: "EVO-ISOJECT-OAT-2LB" }
    ]
  }),
  product({
    title: "Anabolic Mass", brand: "Kevin Levrone", slug: "kevin-levrone-anabolic-mass", featured: false,
    shortDescription: "Ganador de peso: 392 kcal, 30 g de proteína y 60 g de carbohidratos por porción de 100 g (dos medidas), según el fabricante.",
    nutritionalFacts: { servingSize: "2 medidas (100 g)", calories: 392, protein: 30, carbohydrates: 60, fats: 3.5 },
    categories: [category.gainer], goals: [goal.muscle],
    variants: [{ flavor: "Chocolate", size: { value: 3, unit: "kg" }, price: 69.9, stock: 9, sku: "KL-ANABOLIC-CHOC-3KG" }]
  }),
  product({
    title: "Levro Whey Supreme", brand: "Kevin Levrone", slug: "kevin-levrone-levro-whey-supreme", featured: false,
    shortDescription: "Proteína de suero concentrada y aislada: 23 g de proteína y 120 kcal por porción de 30 g.",
    nutritionalFacts: { servingSize: "1 medida (30 g)", calories: 120, protein: 23, carbohydrates: 4, fats: 1 },
    categories: [category.whey], goals: [goal.muscle],
    variants: [{ flavor: "Chocolate", size: { value: 2, unit: "kg" }, price: 74.9, stock: 8, sku: "KL-LEVRO-WHEY-CHOC-2KG" }]
  }),
  product({
    title: "CBUM Thavage Pre-Workout", brand: "Raw Nutrition", slug: "raw-nutrition-cbum-thavage", featured: false,
    shortDescription: `Preentreno de Chris Bumstead: la porción completa de dos medidas aporta 6 g de citrulina, 3,2 g de beta-alanina y 305 mg de cafeína. ${caffeineWarning}`,
    nutritionalFacts: { servingSize: "2 medidas (26,3 g), porción completa", calories: 10, protein: 1, carbohydrates: 2, fats: null },
    categories: [category.pre], goals: [goal.energy],
    variants: [
      { flavor: "Peach Bum", size: { value: 40, unit: "medidas" }, price: 44.9, stock: 9, sku: "RAW-THAVAGE-PEACH-40" },
      { flavor: "Rocket Candy", size: { value: 40, unit: "medidas" }, price: 44.9, stock: 6, sku: "RAW-THAVAGE-ROCKET-40" }
    ]
  }),
  product({
    title: "CBUM Itholate Protein", brand: "Raw Nutrition", slug: "raw-nutrition-cbum-itholate", featured: false,
    shortDescription: "Proteína de suero 100 % aislada de la línea CBUM: 25 g de proteína y 110 kcal por porción de 31 g.",
    nutritionalFacts: { servingSize: "1 medida (31 g)", calories: 110, protein: 25, carbohydrates: 2, fats: 0 },
    categories: [category.isolate], goals: [goal.recovery, goal.muscle],
    variants: [
      { flavor: "Vanilla Oatmeal Cookie", size: { value: 25, unit: "porciones" }, price: 59.9, stock: 7, sku: "RAW-ITHOLATE-VOC-25" },
      { flavor: "Cinnamon Crunch Cereal", size: { value: 25, unit: "porciones" }, price: 59.9, stock: 5, sku: "RAW-ITHOLATE-CCC-25" }
    ]
  })
];

/** Fuentes consultadas el 2026-09-26 (registro de auditoría, C14). */
export const catalogSources: Record<string, string[]> = {
  "gold-standard-100-whey": ["https://www.optimumnutrition.com/en-us/products/gold-standard-100-whey-protein-powder", "https://foods.fatsecret.com/calories-nutrition/optimum-nutrition/gold-standard-100%25-whey---double-rich-chocolate"],
  "dragon-pharma-creatine-monohydrate": ["https://dragonpharmalabs.com/products/creatine-300g", "https://www.ultimatesportnutrition.us/products/dragon-pharma-creatine-monohydrate-300-grams"],
  "dragon-pharma-iso-phorm": ["https://dragonpharmalabs.com/products/isophorm", "https://www.commonwealthnutrition.com/products/dragon-pharma-isophorm-protein-isolate", "https://fitia.app/calories-nutritional-information/iso-phorm-whey-protein-isolate-F656kh7jt6/"],
  "insane-labz-psychotic-gold": ["https://insanelabz.com/products/psychotic-gold/"],
  "insane-labz-psychotic": ["https://insanelabz.com/products/psychotic", "https://www.garagegymreviews.com/psychotic-pre-workout-review"],
  "gold-standard-100-isolate": ["https://www.optimumnutrition.com/en-us/products/gold-standard-100-isolate-whey-protein-powder", "https://foods.fatsecret.com/calories-nutrition/optimum-nutrition/gold-standard-100-isolate"],
  "optimum-nutrition-micronized-creatine": ["https://www.optimumnutrition.com/en-us/products/creatine-monohydrate-micronized-powder"],
  "optimum-nutrition-serious-mass": ["https://www.optimumnutrition.com/en-us/products/serious-mass-weight-gainer-protein-powder"],
  "dymatize-iso100": ["https://dymatize.com/products/iso100-gourmet-chocolate", "https://foods.fatsecret.com/calories-nutrition/dymatize-nutrition/iso-100-hydrolyzed-100%25-whey-protein-isolate---gourmet-chocolate"],
  "dymatize-elite-100-whey": ["https://dymatize.com/products/elite-100-whey-rich-chocolate", "https://foods.fatsecret.com/calories-nutrition/dymatize-nutrition/elite-100-whey-protein-rich-chocolate"],
  "muscletech-nitro-tech-whey-gold": ["https://www.nutritionix.com/i/muscletech/nitro-tech-whey-gold-double-rich-chocolate/583d28628717ecae0dec6aaf", "https://www.iherb.com/pr/muscletech-nitro-tech-100-whey-gold-double-rich-chocolate-5-lbs-2-27-kg/77943"],
  "muscletech-platinum-creatine": ["https://www.muscletech.com/products/platinum-100-creatine"],
  "nutrex-lipo-6-black-uc": ["https://www.iherb.com/pr/nutrex-research-lipo-6-black-ultra-concentrate-60-liqui-caps/44780"],
  "nutrex-outlift": ["https://www.bestpricenutrition.com/products/nutrex-research-outlift-20-servings", "https://barbend.com/nutrex-outlift-pre-workout-review/"],
  "evogen-evp-3d": ["https://www.evogennutrition.com/products/evp-3d"],
  "evogen-isoject": ["https://www.evogennutrition.com/products/isoject", "https://www.eatthismuch.com/calories/chocolate-ultra-pure-whey-isolate-protein-isoject-4053498"],
  "kevin-levrone-anabolic-mass": ["https://levrosupplements.com/gb/kevin-levrone-black-line/30-anabolic-mass-3-kg.html", "https://www.fatsecret.co.in/calories-nutrition/kevin-levrone/anabolic-mass/100g"],
  "kevin-levrone-levro-whey-supreme": ["https://levrosupplements.com/gb/kevin-levrone-silver-line/72-levro-whey-supreme-2-kg.html", "https://fitia.app/calories-nutritional-information/levro-whey-supreme-F6aogovg7d/"],
  "raw-nutrition-cbum-thavage": ["https://www.coalitionnutrition.com/products/cbum-thavage-pre-workout", "https://barbend.com/cbum-thavage-pre-workout-review/"],
  "raw-nutrition-cbum-itholate": ["https://www.coalitionnutrition.com/products/cbum-iso-protein"]
};
