import { useUi } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "./ui/sonner";

export function DesignDemo() {
  const { t } = useUi();
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("designTitle")}</CardTitle>
          <CardDescription>
            shadcn/new-york · neutral · CSS variables · dark-mode ready
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog works</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Focus ring + overlay verified.</p>
            </DialogContent>
          </Dialog>
          <Button onClick={() => toast.success("Toast works")}>Toast</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form + table</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="demo-input">Project name</Label>
            <Input id="demo-input" placeholder="e.g. Site survey 04" />
          </div>
          <Tabs defaultValue="table">
            <TabsList>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="info">Info</TabsTrigger>
            </TabsList>
            <TabsContent value="table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Freq</TableHead>
                    <TableHead>Amp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>100</TableCell>
                    <TableCell>0.42</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>200</TableCell>
                    <TableCell>0.87</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="info">
              <p className="text-sm text-muted-foreground">Tabs + focus rings verified.</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
