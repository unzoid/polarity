import { Fragment } from "react";
import { useNavigation } from "../../lib/router";

/**
 * People's names joined by commas, each isolated (`<bdi>`), so an Arabic or Hebrew name among Latin ones keeps its
 * place instead of the line being reordered around it. With `ids` (name → TMDB person id, `personIds`), a name
 * that has one opens that person's page; the rest stay plain text.
 */
export function NameList({ names, ids }: { names: readonly string[]; ids?: ReadonlyMap<string, number> }) {
  const { navigate } = useNavigation();
  return (
    <>
      {names.map((name, i) => {
        const id = ids?.get(name);
        return (
          <Fragment key={i}>
            {i > 0 && ", "}
            {id != null ? (
              <button className="name-link" onClick={() => navigate({ name: "person", id, title: name })}>
                <bdi>{name}</bdi>
              </button>
            ) : (
              <bdi>{name}</bdi>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
