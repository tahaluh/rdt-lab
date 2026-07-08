import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataDirs, inputDir } from "../rdt/fileUtils";

async function main() {
  await ensureDataDirs();
  await fs.writeFile(
    path.join(inputDir, "hello-rdt.txt"),
    [
      "RDT Lab demonstra Transferencia Confiavel de Dados sobre UDP.",
      "Este arquivo pequeno deixa Stop-and-Wait facil de acompanhar no dashboard.",
      "Perdas e corrupcoes sao simuladas, mas o transporte usa UDP real com node:dgram."
    ].join("\n")
  );

  const lines = Array.from({ length: 300 }, (_, index) => `Linha ${index + 1}: payload de teste para muitos pacotes Stop-and-Wait.`);
  await fs.writeFile(path.join(inputDir, "large-demo.txt"), lines.join("\n"));
  console.log("Seed files written to data/input");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
