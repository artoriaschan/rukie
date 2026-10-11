import { expect, test } from "bun:test";
import { ownResources } from "./owned-resources.ts";

test("fixture shutdown owns late initialization and closes it exactly once", async () => {
  const owner = ownResources();
  const initialized = Promise.withResolvers<string>();
  const released: string[] = [];
  const acquired = owner.acquire(
    () => initialized.promise,
    (resource) => {
      released.push(resource);
    },
  );
  const failure = acquired.catch((error: unknown) => error);
  const closed = owner.close();
  expect(released).toEqual([]);
  initialized.resolve("late listener");
  expect(await failure).toEqual(new Error("Fixture closed during initialization"));
  await closed;
  await owner.close();
  expect(released).toEqual(["late listener"]);
});
