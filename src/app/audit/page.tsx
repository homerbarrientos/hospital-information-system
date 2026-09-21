import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");

  const { data: roles } = await supabase
    .from("user_roles")
    .select("facility_id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);

  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;

  let eventsQuery = supabase
    .from("audit_events")
    .select("id,actor_id,created_at,event_type,object_type,object_id,result,reason", { count: "exact" })
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (query) {
    eventsQuery = eventsQuery.or(
      `event_type.ilike.%${query}%,object_type.ilike.%${query}%,reason.ilike.%${query}%`,
    );
  }

  const { data: events, error, count } = await eventsQuery;
  const total = count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeading
        eyebrow="Compliance evidence"
        title="Audit and privileged actions"
        description="Append-only activity evidence from actual Hospital ONE transactions."
      />

      <form className="toolbar" method="get">
        <div className="search">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search action, object type, or reason"
            aria-label="Search audit events"
          />
        </div>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>

      {error ? <div className="form-error">Unable to load audit events: {error.message}</div> : null}

      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Object</th>
              <th>Result</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {(events || []).map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.created_at)}</td>
                <td>{event.actor_id ? String(event.actor_id).slice(0, 8) : "System"}</td>
                <td><strong>{event.event_type}</strong></td>
                <td>
                  <strong>{event.object_type}</strong>
                  <small>{event.object_id ? String(event.object_id) : "—"}</small>
                </td>
                <td>
                  <span className={`badge ${event.result === "failed" ? "red" : "green"}`}>
                    {event.result || "success"}
                  </span>
                </td>
                <td>{event.reason || "—"}</td>
              </tr>
            ))}
            {!events?.length ? (
              <tr>
                <td colSpan={6} className="empty-state">No audit events match this search.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="registry-pagination">
        <span>
          Showing {total ? from + 1 : 0}–{Math.min(from + PAGE_SIZE, total)} of {total}
        </span>
        <div>
          <a
            className={`btn btn-secondary ${page <= 1 ? "disabled" : ""}`}
            aria-disabled={page <= 1}
            href={page <= 1 ? "#" : `/audit?q=${encodeURIComponent(query)}&page=${page - 1}`}
          >
            Previous
          </a>
          <span>Page {page} of {pages}</span>
          <a
            className={`btn btn-secondary ${page >= pages ? "disabled" : ""}`}
            aria-disabled={page >= pages}
            href={page >= pages ? "#" : `/audit?q=${encodeURIComponent(query)}&page=${page + 1}`}
          >
            Next
          </a>
        </div>
      </div>
    </>
  );
}
