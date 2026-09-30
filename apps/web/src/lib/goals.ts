import { Activity, Dumbbell, Flame, Leaf } from "lucide-react";

// Objetivos de uso con los que la tienda organiza el catálogo (slug de la API).
export const goals = [
  { slug: "desarrollo-muscular", label: "Fuerza y músculo", note: "Proteínas, creatina y ganadores de peso", icon: Dumbbell },
  { slug: "energia", label: "Energía", note: "Preentrenos para tu rutina", icon: Flame },
  { slug: "recuperacion", label: "Recuperación", note: "Proteínas, aminoácidos e hidratación", icon: Activity },
  { slug: "perdida-de-grasa", label: "Control de peso", note: "Productos para acompañar tu rutina", icon: Leaf }
] as const;

/** Etiqueta de la tienda para un objetivo; si no es uno de los cuatro, el texto del identificador. */
export const goalName = (slug: string) => goals.find(goal => goal.slug === slug)?.label ?? slug.replace(/-/g, " ").replace(/^./, letter => letter.toUpperCase());
