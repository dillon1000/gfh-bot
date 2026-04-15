import { z } from "zod";

const emptyStringToUndefined = <T>(value: T): T | string | undefined => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

export const optionalNonEmptyString = () =>
	z.preprocess(emptyStringToUndefined, z.string().min(1).optional());

export const optionalUrlString = () =>
	z.preprocess(emptyStringToUndefined, z.string().url().optional());

export const optionalEnum = <
	const TValues extends readonly [string, ...string[]],
>(
	values: TValues,
) => z.preprocess(emptyStringToUndefined, z.enum(values).optional());
