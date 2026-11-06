import { Skeleton, SkeletonGroup, SkeletonLines } from '../../ui';

/** The shape of the analysis while the report loads: verdict, the two ROIs, the chart and the assumptions rail. */
export function EconomicsSkeleton() {
  return (
    <SkeletonGroup label="Loading cognitive economics" className="econ">
      <div className="econ-verdict">
        <Skeleton width={180} height={12} />
        <Skeleton width="62%" height={44} />
        <SkeletonLines lines={3} />
      </div>
      <div className="econ-roi-pair">
        <div className="econ-roi">
          <Skeleton width={140} height={12} />
          <Skeleton width={150} height={44} />
          <SkeletonLines lines={2} />
        </div>
        <div className="econ-roi">
          <Skeleton width={140} height={12} />
          <Skeleton width={150} height={44} />
          <SkeletonLines lines={2} />
        </div>
      </div>
      <div className="econ-grid">
        <Skeleton height={380} radius={8} />
        <Skeleton height={380} radius={8} />
      </div>
    </SkeletonGroup>
  );
}
