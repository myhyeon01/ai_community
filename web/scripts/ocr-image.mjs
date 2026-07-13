import { createWorker } from "tesseract.js";

const imagePath = process.argv[2];

if (!imagePath) {
  process.exit(1);
}

const worker = await createWorker("kor+eng", 1, {
  logger: () => {},
});

try {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6",
  });
  const { data } = await worker.recognize(imagePath);
  process.stdout.write(data?.text || "");
} finally {
  await worker.terminate();
}
