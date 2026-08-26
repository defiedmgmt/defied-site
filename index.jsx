import Head from "next/head";
import dynamic from "next/dynamic";

// The app uses the browser (localStorage), so render it client-side only.
const App = dynamic(() => import("../components/App"), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Defied MGMT</title>
        <meta name="description" content="Defied Management — independent music management and publishing administration." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
      </Head>
      <App />
    </>
  );
}
