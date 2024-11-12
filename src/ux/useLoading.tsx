import { useContext } from "react";
import { LoadingContext } from "./LoadingContext";

export const useLoading = () => {
  const loading = useContext(LoadingContext);
  return loading;
};
