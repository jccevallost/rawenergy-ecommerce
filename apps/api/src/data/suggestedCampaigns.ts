// Campañas sugeridas por temporada en Ecuador. Se cargan una sola vez, cuando no
// existe ninguna campaña, y el negocio puede editarlas, pausarlas o eliminarlas.
// Seleccionan productos reales del catálogo por objetivo; no anuncian
// descuentos, precios ni beneficios de salud. Los plazos citados son los
// confirmados por el propietario (4 h express Quito y Valles, 24–48 h nacional).
const all = ["desarrollo-muscular", "energia", "recuperacion", "perdida-de-grasa"];

export const suggestedCampaigns = [
  {
    slug: "vuelve-a-tu-rutina", eyebrow: "Septiembre en marcha", title: "Vuelve a tu rutina con todo",
    message: "Proteínas, creatinas y preentrenos para retomar el gimnasio con constancia. Elige tu presentación y recíbelo en casa.",
    ctaLabel: "Ver la selección", theme: "NOCHE", startsOn: "2026-09-01", endsOn: "2026-10-15", active: true, priority: 90,
    goals: ["desarrollo-muscular", "energia"]
  },
  {
    slug: "recupera-como-pro", eyebrow: "Después de entrenar", title: "Tu rutina no termina en la última serie",
    message: "Proteínas, aminoácidos e hidratación para después de entrenar. Compara porciones e ingredientes en cada producto.",
    ctaLabel: "Ver recuperación", theme: "CLARO", startsOn: "2026-10-01", endsOn: "2026-11-25", active: true, priority: 70,
    goals: ["recuperacion"]
  },
  {
    slug: "regala-energia", eyebrow: "Navidad", title: "Regala energía esta Navidad",
    message: "Para quien entrena contigo: proteínas, creatinas y preentrenos de marcas reconocidas, con envío a todo el Ecuador.",
    ctaLabel: "Ver ideas de regalo", theme: "ORO", startsOn: "2026-11-26", endsOn: "2026-12-24", active: true, priority: 95,
    goals: ["desarrollo-muscular", "energia", "recuperacion"]
  },
  {
    slug: "proposito-ano-nuevo", eyebrow: "Año nuevo", title: "Tu propósito empieza en el primer entrenamiento",
    message: "Arma tu rutina de fuerza o de control de peso y compra en minutos, sin crear una cuenta.",
    ctaLabel: "Empezar ahora", theme: "NOCHE", startsOn: "2026-12-26", endsOn: "2027-02-07", active: true, priority: 95,
    goals: ["desarrollo-muscular", "perdida-de-grasa"]
  },
  {
    slug: "temporada-de-playa", eyebrow: "Carnaval y playa", title: "Llega con energía a la temporada de playa",
    message: "Preentrenos y productos para acompañar tu rutina de control de peso antes de tus días en la costa.",
    ctaLabel: "Ver la selección", theme: "CLARO", startsOn: "2027-01-15", endsOn: "2027-03-15", active: true, priority: 85,
    goals: ["perdida-de-grasa", "energia"]
  },
  {
    slug: "temporada-de-volumen", eyebrow: "Temporada de volumen", title: "Suma fuerza, repetición a repetición",
    message: "Ganadores de peso, creatinas y proteínas para tus metas de fuerza. Revisa porciones e ingredientes en cada producto.",
    ctaLabel: "Ver fuerza y músculo", theme: "ORO", startsOn: "2027-03-16", endsOn: "2027-05-31", active: true, priority: 80,
    goals: ["desarrollo-muscular"]
  },
  {
    slug: "dia-del-padre", eyebrow: "Día del Padre", title: "Para papá, que también entrena",
    message: "Elige un suplemento de su marca favorita. Compra sin cuenta y paga por transferencia.",
    ctaLabel: "Ver regalos para papá", theme: "ORO", startsOn: "2027-06-01", endsOn: "2027-06-20", active: true, priority: 95,
    goals: ["desarrollo-muscular", "recuperacion", "energia"]
  },
  {
    slug: "vacaciones-activas", eyebrow: "Vacaciones", title: "Vacaciones activas, rutina constante",
    message: "Energía e hidratación para entrenar también en vacaciones, con envío nacional en 24 a 48 horas.",
    ctaLabel: "Ver energía", theme: "NOCHE", startsOn: "2027-07-01", endsOn: "2027-08-31", active: true, priority: 80,
    goals: ["energia", "recuperacion"]
  },
  {
    slug: "encuentra-tu-suplemento", eyebrow: "Suplementos deportivos", title: "Encuentra tu suplemento en minutos",
    message: "Compara precios, presentaciones y disponibilidad. Express en 4 horas en Quito y Valles.",
    ctaLabel: "Ver disponibles", theme: "NOCHE", startsOn: "2026-01-01", endsOn: "2030-12-31", active: true, priority: 10,
    goals: all
  },
  {
    slug: "fuerza-y-musculo", eyebrow: "Fuerza y músculo", title: "Proteínas y creatinas para tu rutina de fuerza",
    message: "Revisa ingredientes y porciones antes de elegir tu presentación. Compra sin crear una cuenta.",
    ctaLabel: "Ver productos de fuerza", theme: "ORO", startsOn: "2026-01-01", endsOn: "2030-12-31", active: true, priority: 6,
    goals: ["desarrollo-muscular"]
  },
  {
    slug: "energia-para-entrenar", eyebrow: "Energía", title: "Prepara tu próximo entrenamiento",
    message: "Preentrenos y productos de energía con su disponibilidad visible antes de comprar.",
    ctaLabel: "Ver productos de energía", theme: "CLARO", startsOn: "2026-01-01", endsOn: "2030-12-31", active: true, priority: 5,
    goals: ["energia"]
  }
];
