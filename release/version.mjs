export function releaseMetadata(version, requestedTag) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
      version,
    )
  )
    throw new Error("Release must use a semantic version from package.json");
  const tag = `v${version}`;
  if (requestedTag && requestedTag !== tag)
    throw new Error(`Release tag ${requestedTag} does not match ${tag}`);
  return { version, macVersion: version.split("-")[0], tag };
}
