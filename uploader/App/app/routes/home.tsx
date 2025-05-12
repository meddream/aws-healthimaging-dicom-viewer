import type { Route } from "./+types/home";
import { Uploader } from "../Uploader/uploader";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AWS HealthImaging Uploader." },
    { name: "description", content: "AWS HealthImaging Uploader." },
  ];
}

export default function Home() {
  return <Uploader />;
}
