import { Text, TextClassContext } from "./text";
import { cn } from "../../lib/utils";
import { View } from "react-native";

function Card({ className, ...props }: Omit<React.ComponentProps<typeof View>, "key" | "ref">) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View
        className={cn(
          "bg-card border-border flex flex-col gap-6 rounded-xl border py-6 shadow-sm shadow-black/5",
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function CardHeader({
  className,
  ...props
}: Omit<React.ComponentProps<typeof View>, "key" | "ref">) {
  return <View className={cn("flex flex-col gap-1.5 px-6", className)} {...props} />;
}

function CardTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Text>, "key" | "ref">) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Text>, "key" | "ref">) {
  return <Text className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

function CardContent({
  className,
  ...props
}: Omit<React.ComponentProps<typeof View>, "key" | "ref">) {
  return <View className={cn("px-6", className)} {...props} />;
}

function CardFooter({
  className,
  ...props
}: Omit<React.ComponentProps<typeof View>, "key" | "ref">) {
  return <View className={cn("flex flex-row items-center px-6", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
