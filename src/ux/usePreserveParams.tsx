import { useSearchParams } from "react-router-dom";

export const usePreserveParams = () => {
  const [searchParams] = useSearchParams();
  const useParams = (params?: { [key: string]: string }) => {
    Array.from(searchParams.entries()).forEach((entry) => {
      if (entry[0] !== "elections") {
        searchParams.delete(entry[0]);
      }
    });
    if (params) {
      Object.keys(params).forEach((key) => {
        searchParams.set(key, params[key]);
      });
    }
    return searchParams;
  };
  return useParams;
};
