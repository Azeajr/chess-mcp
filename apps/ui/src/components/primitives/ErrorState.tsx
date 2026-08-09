import RegionState from "./RegionState";

export interface ErrorStateProps {
  title?: string;
  message: string;
}

export default function ErrorState(props: ErrorStateProps) {
  return (
    <RegionState
      status="error"
      title={props.title ?? "Unable to display this content"}
      message={props.message}
    />
  );
}
