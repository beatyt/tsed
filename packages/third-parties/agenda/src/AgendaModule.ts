import {AfterListen, DIContext, Logger, OnDestroy, runInContext} from "@tsed/common";
import {Constant, Inject, InjectorService, Module, Provider} from "@tsed/di";
import {Job, Processor} from "agenda";
import {v4 as uuid} from "uuid";
import {PROVIDER_TYPE_AGENDA} from "./constants/constants";
import {AgendaStore} from "./interfaces/AgendaStore";
import {AgendaService} from "./services/AgendaFactory";

@Module()
export class AgendaModule implements OnDestroy, AfterListen {
  @Inject()
  protected logger: Logger;

  @Inject()
  protected injector: InjectorService;

  @Inject()
  protected agenda: AgendaService;

  @Constant("agenda.enabled", false)
  private enabled: boolean;

  @Constant("agenda.disableJobProcessing", false)
  private disableJobProcessing: boolean;

  async $afterListen(): Promise<any> {
    if (this.enabled) {
      const providers = this.getProviders();

      if (!this.disableJobProcessing) {
        this.logger.info("Agenda add definitions...");
        providers.forEach((provider) => this.addAgendaDefinitionsForProvider(provider));

        await this.injector.emit("$beforeAgendaStart");
      }

      await this.agenda.start();

      if (!this.disableJobProcessing) {
        this.logger.info("Agenda add scheduled jobs...");
        await Promise.all(providers.map((provider) => this.scheduleJobsForProvider(provider)));

        await this.injector.emit("$afterAgendaStart");
      }
    } else {
      this.logger.info("Agenda disabled...");
    }
  }

  async $onDestroy(): Promise<any> {
    if (this.enabled) {
      await this.agenda.stop();
      await this.agenda.close({force: true});

      this.logger.info("Agenda stopped...");
    }
  }

  define(name: string, options?: any, processor?: any) {
    return this.agenda.define(name, options, (job: Job) => {
      const $ctx = new DIContext({
        injector: this.injector,
        id: uuid(),
        logger: this.injector.logger
      });

      $ctx.set("job", job);

      return runInContext($ctx, () => processor(job));
    });
  }

  every(interval: string, name: string, data?: any, options?: any) {
    return this.agenda.every(interval, name, data, options);
  }

  schedule(when: Date | string, name: string, data?: any) {
    return this.agenda.schedule(when, name, data);
  }

  now(name: string, data?: any) {
    return this.agenda.now(name, data);
  }

  create(name: string, data?: any) {
    return this.agenda.create(name, data);
  }

  protected getProviders(): Provider<any>[] {
    return this.injector.getProviders(PROVIDER_TYPE_AGENDA);
  }

  protected addAgendaDefinitionsForProvider(provider: Provider): void {
    const store = provider.store.get<AgendaStore>("agenda", {});

    if (!store.define) {
      return;
    }

    Object.entries(store.define).forEach(([propertyKey, {name, ...options}]) => {
      const instance = this.injector.get(provider.token);

      const jobProcessor: Processor = instance[propertyKey].bind(instance) as Processor;
      const jobName = this.getNameForJob(propertyKey, store.namespace, name);

      this.define(jobName, options, jobProcessor);
    });
  }

  protected async scheduleJobsForProvider(provider: Provider<any>): Promise<void> {
    const store = provider.store.get<AgendaStore>("agenda", {});

    if (!store.every) {
      return;
    }

    const promises = Object.entries(store.every).map(([propertyKey, {interval, name, ...options}]) => {
      const jobName = this.getNameForJob(propertyKey, store.namespace, name);

      return this.every(interval, jobName, {}, options);
    });

    await Promise.all(promises);
  }

  protected getNameForJob(propertyKey: string, namespace?: string, customName?: string): string {
    const name = customName || propertyKey;
    return namespace ? `${namespace}.${name}` : name;
  }
}
