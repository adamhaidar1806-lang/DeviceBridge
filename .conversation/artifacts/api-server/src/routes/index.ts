import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deviceBridgeRouter from "./devicebridge";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deviceBridgeRouter);

export default router;
