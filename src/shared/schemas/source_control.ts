import { z } from "zod";

export const ScmFileStatusSchema = z.enum(["M", "A", "D", "R", "U", "C"]);
export type ScmFileStatus = z.infer<typeof ScmFileStatusSchema>;

export const ScmFileSchema = z.object({
	path: z.string(),
	status: ScmFileStatusSchema,
});
export type ScmFile = z.infer<typeof ScmFileSchema>;

export const ScmGroupSchema = z.object({
	total: z.number(),
	files: z.array(ScmFileSchema),
});
export type ScmGroup = z.infer<typeof ScmGroupSchema>;

export const ScmCheckoutSchema = z.object({
	path: z.string(),
	isMain: z.boolean(),
	branch: z.string().nullable(),
	head: z.string().nullable(),
	ok: z.boolean(),
	merge: ScmGroupSchema,
	staged: ScmGroupSchema,
	changes: ScmGroupSchema,
});
export type ScmCheckout = z.infer<typeof ScmCheckoutSchema>;

export const ScmFailureReasonSchema = z.enum(["not-a-repo", "failed"]);
export type ScmFailureReason = z.infer<typeof ScmFailureReasonSchema>;

export const ScmSnapshotOkSchema = z.object({
	ok: z.literal(true),
	fetchedAt: z.number(),
	checkouts: z.array(ScmCheckoutSchema),
});
export type ScmSnapshotOk = z.infer<typeof ScmSnapshotOkSchema>;

export const ScmSnapshotSchema = z.discriminatedUnion("ok", [
	ScmSnapshotOkSchema,
	z.object({ ok: z.literal(false), reason: ScmFailureReasonSchema }),
]);
export type ScmSnapshot = z.infer<typeof ScmSnapshotSchema>;

export const SCM_GROUP_LIMIT = 500;
