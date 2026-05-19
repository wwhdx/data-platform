import { query } from "../../../storage/db";
import { FIXTURE_META, FIXTURE_SOURCE_ID } from "../../fixtures/fixtureConnector";

export async function ensureFixtureSource(): Promise<void> {
  await query(
    `INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use, status)
     VALUES ($1, $2, $3, 'none', 'unlimited', $4, $5, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      FIXTURE_SOURCE_ID,
      FIXTURE_META.name,
      FIXTURE_META.baseUrl,
      FIXTURE_META.license,
      FIXTURE_META.commercialUse,
    ],
  );
}
