"use client";

import * as React from "react";
import { PanelLeftIcon } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent } from "@recall/ui-web/components/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@recall/ui-web/components/tooltip";

type SidebarContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);
const sidebarMenuButtonClassName =
  "peer/menu-button flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-1.5";

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("Sidebar components must be used inside SidebarProvider.");
  return context;
}

function SidebarProvider({
  children,
  defaultOpen = true,
  className,
}: React.ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({ open, setOpen, mobileOpen, setMobileOpen }),
    [open, mobileOpen],
  );
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={300}>
        <div
          data-slot="sidebar-wrapper"
          data-state={open ? "expanded" : "collapsed"}
          className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

function Sidebar({ children, className, ...props }: React.ComponentProps<"aside">) {
  const { open, mobileOpen, setMobileOpen } = useSidebar();
  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <aside
        data-slot="sidebar"
        data-state={open ? "expanded" : "collapsed"}
        aria-label="Application navigation"
        className={cn(
          "group/sidebar fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col border-r bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 md:flex",
          "data-[state=collapsed]:w-[var(--sidebar-width-icon)]",
          "max-md:hidden",
          className,
        )}
        {...props}
      >
        {children}
      </aside>
      <SheetContent
        side="left"
        aria-label="Application navigation"
        className={cn(
          "group/sidebar w-[var(--sidebar-width)] max-w-none border-0 bg-sidebar p-0 text-sidebar-foreground md:hidden",
          className,
        )}
        showCloseButton={false}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2",
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex flex-col gap-2 overflow-x-hidden p-2", className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col p-1", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "flex h-[34px] shrink-0 items-center rounded-md px-2 text-[10px] font-medium tracking-[0.08em] text-muted-foreground outline-none group-data-[state=collapsed]/sidebar:invisible",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupAction({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="sidebar-group-action"
      type="button"
      className={cn(
        "absolute top-3 right-3 flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

function SidebarMenuAction({
  className,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & { showOnHover?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-action"
      type="button"
      className={cn(
        "absolute top-1.5 right-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4",
        showOnHover &&
          "md:opacity-0 md:group-hover/menu-item:opacity-100 md:group-focus-within/menu-item:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuButton({
  className,
  isActive = false,
  tooltip,
  keepMobileOpen = false,
  onClick,
  ...props
}: React.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string;
  keepMobileOpen?: boolean;
}) {
  const { open, setMobileOpen } = useSidebar();
  const button = (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive}
      onClick={(event) => {
        onClick?.(event);
        if (!keepMobileOpen) setMobileOpen(false);
      }}
      className={cn(sidebarMenuButtonClassName, className)}
      {...props}
    />
  );
  if (!tooltip || open) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen, setMobileOpen } = useSidebar();
  return (
    <button
      data-slot="sidebar-trigger"
      type="button"
      aria-label="Toggle navigation"
      title="Toggle navigation"
      {...props}
      onClick={() => {
        if (window.matchMedia("(max-width: 767px)").matches) setMobileOpen((value) => !value);
        else setOpen((value) => !value);
      }}
      className={cn(sidebarMenuButtonClassName, "justify-center", className)}
    >
      <PanelLeftIcon className="size-4" />
      {children}
      <span className="sr-only">{open ? "Collapse sidebar" : "Expand sidebar"}</span>
    </button>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative min-h-svh min-w-0 flex-1 bg-background md:ml-[var(--sidebar-width)] group-data-[state=collapsed]/sidebar-wrapper:md:ml-[var(--sidebar-width-icon)]",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  className,
  isActive = false,
  size = "md",
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean; size?: "sm" | "md" }) {
  const { setMobileOpen } = useSidebar();
  return (
    <button
      data-slot="sidebar-menu-sub-button"
      data-active={isActive}
      data-size={size}
      type="button"
      onClick={(event) => {
        props.onClick?.(event);
        setMobileOpen(false);
      }}
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[size=sm]:text-xs data-[size=md]:text-sm [&>svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = useSidebar();
  return (
    <button
      data-slot="sidebar-rail"
      aria-label="Toggle sidebar"
      title="Toggle sidebar"
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "group/rail absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 cursor-ew-resize transition-all after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border md:flex",
        "group-data-[side=left]/sidebar-wrapper:cursor-w-resize group-data-[side=right]/sidebar-wrapper:cursor-e-resize",
        open ? "left-[--sidebar-width]" : "left-[--sidebar-width-icon]",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarProvider,
  SidebarTrigger,
};
