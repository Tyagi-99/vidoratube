/**
 * Stream B shared helper: recursive JSON zod schema.
 *
 * TanStack Start server-fn wrappers type-check that values crossing the
 * client/server boundary are serializable — `Record<string, unknown>` fails
 * that check, so JSON-shaped inputs/outputs use this schema instead.
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

/** Zod schema whose inferred type is the serializable `Json` union. */
export const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
