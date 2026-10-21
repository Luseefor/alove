"use client";
import { createContext, useContext, type ReactNode } from "react";
const ProjectToolsContext = createContext<ReactNode>(null);
export const ProjectToolsProvider = ProjectToolsContext.Provider;
export const useProjectTools = () => useContext(ProjectToolsContext);
