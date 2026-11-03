import { PageHead } from '../components/PageHead.tsx'
import { Link } from '../router.tsx'

export function NotFound({ what }: { what: string }) {
  return (
    <>
      <PageHead title="Not found" docTitle="Not found" crumbs={[{ href: '/', label: 'Board' }]} />
      <div className="page-body">
        <div className="card not-found">
          <p>There is no {what} here. It may have been mistyped, or it belongs to another server.</p>
          <p>
            <Link href="/" className="text-link">
              Back to the board
            </Link>
          </p>
        </div>
      </div>
    </>
  )
}
