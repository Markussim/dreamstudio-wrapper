import { grpc } from "@improbable-eng/grpc-web";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

grpc.setDefaultTransport(NodeHttpTransport());

import GenerationService from "./generation/generation_pb_service";
import Generation from "./generation/generation_pb";

class Generator {
  private token: string;
  private imageParams: Generation.ImageParameters;
  private transformType: Generation.TransformType;
  private request: Generation.Request;
  private samplerParams: Generation.SamplerParameters;
  private stepParams: Generation.StepParameter;
  private scheduleParameters: Generation.ScheduleParameters;

  /**
   *
   * @param setup.token Your dream studio API key
   * @param setup.width The width of the image to generate
   * @param setup.height The height of the image to generate
   * @param setup.steps The number of steps to use for the image generation, more steps will take longer and produce a higher quality image
   * @param setup.cfg The CFG scale to use for the image generation
   * @param setup.seed The seed to use for the image generation, if not provided a random seed will be used
   */
  constructor(setup: {
    token: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed?: number;
  }) {
    this.imageParams = new Generation.ImageParameters();
    this.imageParams.setWidth(setup.width);
    this.imageParams.setHeight(setup.height);
    this.imageParams.addSeed(
      setup.seed || Math.floor(Math.random() * 1000000000)
    );
    this.imageParams.setSamples(1);
    this.imageParams.setSteps(setup.steps);

    this.transformType = new Generation.TransformType();
    this.transformType.setDiffusion(
      Generation.DiffusionSampler.SAMPLER_K_DPMPP_2M
    );
    this.imageParams.setTransform(this.transformType);

    this.request = new Generation.Request();
    this.request.setEngineId("stable-diffusion-768-v2-1");
    this.request.setRequestedType(Generation.ArtifactType.ARTIFACT_IMAGE);
    this.request.setClassifier(new Generation.ClassifierParameters());

    this.samplerParams = new Generation.SamplerParameters();
    this.samplerParams.setCfgScale(setup.cfg);

    this.stepParams = new Generation.StepParameter();
    this.scheduleParameters = new Generation.ScheduleParameters();

    this.stepParams.setScaledStep(0);
    this.stepParams.setSampler(this.samplerParams);
    this.stepParams.setSchedule(this.scheduleParameters);

    this.imageParams.addParameters(this.stepParams);
    this.request.setImage(this.imageParams);

    this.token = setup.token;
  }

  /**
   *
   * @param prompt The prompt to use for the image generation
   * @returns A buffer containing the image data
   */
  public async generateImage(prompt: string): Promise<Buffer> {
    const promptText = new Generation.Prompt();
    promptText.setText(prompt);

    this.request.addPrompt(promptText);

    const metadata = new grpc.Metadata();
    metadata.set("Authorization", "Bearer " + this.token);

    return new Promise((resolve, reject) => {
      // Create a generation client
      const generationClient = new GenerationService.GenerationServiceClient(
        "https://grpc.stability.ai",
        {}
      );

      const generation = generationClient.generate(this.request, metadata);

      generation.on("data", (data) => {
        data.getArtifactsList().forEach((artifact) => {
          // Oh no! We were filtered by the NSFW classifier!
          if (
            artifact.getType() === Generation.ArtifactType.ARTIFACT_TEXT &&
            artifact.getFinishReason() === Generation.FinishReason.FILTER
          ) {
            return console.error(
              "Your image was filtered by the NSFW classifier."
            );
          }

          // Make sure we have an image
          if (artifact.getType() !== Generation.ArtifactType.ARTIFACT_IMAGE)
            return;

          // You can convert the raw binary into a base64 string
          resolve(Buffer.from(artifact.getBinary()));
        });
      });

      // Anything other than `status.code === 0` is an error
      generation.on("status", (status) => {
        if (status.code === 0) reject(status);
      });
    });
  }
}

export default Generator;
