export const ProductSkeleton = () => (
  <div className="card card-skeleton" aria-hidden="true">
    <div className="card-media skeleton" />
    <div className="card-body">
      <span className="skeleton skeleton-line short" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-line medium" />
      <span className="skeleton skeleton-button" />
    </div>
  </div>
);
