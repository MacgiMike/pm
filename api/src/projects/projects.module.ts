import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { BudgetService } from './budget.service';
import { MembersService } from './members.service';
import { BudgetController, MembersController, MyController, ProjectsController, TasksController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [ProjectsController, TasksController, BudgetController, MembersController, MyController],
  providers: [AccessService, ProjectsService, TasksService, BudgetService, MembersService],
  exports: [AccessService, ProjectsService, TasksService, BudgetService],
})
export class ProjectsModule {}
