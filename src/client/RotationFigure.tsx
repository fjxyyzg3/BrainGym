import type { RotationTrial } from "../shared/mental-rotation";
import { outlinePath, rotationPair } from "../shared/rotation-geometry";

export function RotationFigure({ trial }: { trial: RotationTrial }) {
  const pair = rotationPair(trial);
  return (
    <div className="rotation-pair" data-testid="rotation-pair">
      {(
        [
          ["参考图", pair.reference],
          ["待判断图", pair.comparison],
        ] as const
      ).map(([label, points]) => (
        <figure key={label}>
          <figcaption>{label}</figcaption>
          <svg role="img" aria-label={label} viewBox={pair.viewBox}>
            <path d={outlinePath(points)} />
          </svg>
        </figure>
      ))}
    </div>
  );
}
