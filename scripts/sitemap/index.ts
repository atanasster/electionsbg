import fs from "fs";
import path from "path";
import { RouteDef, routeDefs } from "./route_defs";
import { fileURLToPath } from "url";
import { PartyInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const election = "2024_10_27";
const projectPath = path.resolve(__dirname, "../../");

const homePage = "https://electionsbg.com";

const routeXML = (url: string, file: string) => {
  const fName = path.resolve(projectPath, file);
  const stat = fs.statSync(fName);
  const mod = stat.mtime.toISOString().slice(0, 10);
  return `<url><loc>${url === "index" ? homePage : `${homePage}${url}`}</loc><lastmod>${mod}</lastmod><changefreq>monthly</changefreq></url>`;
};

const getRoute = (route: RouteDef, rootUrl: string): string[] => {
  const result: string[] = [];
  if (route.children) {
    route.children.forEach((r) => {
      result.push(...getRoute(r, `${rootUrl}/${route.path}`));
    });
  } else {
    const routes = route.path.split(":id");
    if (routes.length > 1) {
      if (route.file === "parties") {
        const partiesFileName = `${projectPath}/public/${election}/cik_parties.json`;
        const data = fs.readFileSync(partiesFileName, "utf-8");
        const parties: PartyInfo[] = JSON.parse(data);
        parties.forEach((party) => {
          const r = routeXML(
            `${rootUrl}/${routes[0]}${party.nickName}`,
            partiesFileName,
          );
          result.push(r);
        });
      } else {
        const folders = route.file?.split(":id");
        if (!folders) {
          throw new Error("Must assign file property: " + route.path);
        }
        const folder = path.resolve(projectPath, folders[0]);
        const files = fs.readdirSync(folder);
        if (routes[1] === "") {
          files.forEach((f) => {
            const fileName = path.resolve(folder, f);
            const fileParts = f.split(".");
            const p = routes.join(fileParts[0]);
            const r = routeXML(`${rootUrl}/${p}`, fileName);
            result.push(r);
          });
        } else {
          console.log(routes);
        }
      }
    } else {
      if (!route.file) {
        throw new Error("Missing file name: " + route.path);
      }
      result.push(routeXML(`${rootUrl}/${route.path}`, route.file));
    }
  }
  return result;
};

const urls: string[] = [];
routeDefs(election).forEach((r) => {
  urls.push(...getRoute(r, ""));
});
const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\r\n${urls.join("\r\n")}\r\n</urlset>`;
const xmlFIleName = `${projectPath}/public/sitemap.xml`;
fs.writeFileSync(xmlFIleName, xml, "utf-8");
