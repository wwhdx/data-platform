import type { LibraryDb } from "./types";
export async function assertReaderRole(db: LibraryDb): Promise<void> {
 const { rows } = await db.query<{
  admin:boolean; owner:boolean; writable:boolean; can_create:boolean; read_only:boolean;
 }>(`SELECT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls) admin,
  pg_get_userbyid(d.datdba)=current_user owner,
  has_table_privilege(current_user,'public.raw_documents','INSERT,UPDATE,DELETE,TRUNCATE') writable,
  (has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'library','CREATE')) can_create,
  current_setting('default_transaction_read_only')='on' read_only
  FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`);
 const row=rows[0];
 if (!row || row.admin || row.owner || row.writable || row.can_create || !row.read_only)
  throw new Error("Reader requires a dedicated SELECT-only role, without database/schema ownership, with default_transaction_read_only=on");
}
